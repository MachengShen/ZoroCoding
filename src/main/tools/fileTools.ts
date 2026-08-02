import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  canonicalizePath,
  isPathContained,
} from "./permissionEngine";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron",
  "dist-renderer",
  "build",
  "coverage",
]);

const MAX_SEARCH_RESULTS = 500;
export const MAX_LIST_ENTRIES = 500;

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function unifiedDiff(
  path: string,
  before: string,
  after: string,
): string {
  if (before === after) {
    return "";
  }
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

export class FileConflictError extends Error {
  readonly code = "file_conflict";

  constructor(path: string) {
    super(`文件 ${path} 在读取后已被其他操作修改。`);
    this.name = "FileConflictError";
  }
}

export class PathOutsideProjectError extends Error {
  readonly code = "path_outside_project";

  constructor(path: string) {
    super(`路径 ${path} 不在当前项目目录内。`);
    this.name = "PathOutsideProjectError";
  }
}

export interface FileReadResult {
  content: string;
  sha256: string;
  mtimeMs: number;
  canonicalPath: string;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface FileWriteResult {
  path: string;
  patch: string;
  beforeSha256: string;
  afterSha256: string;
}

export interface ApprovedFileAccess {
  kind: "read_file" | "write_file";
  canonicalPath: string;
}

export interface FileToolsOptions {
  signal?: AbortSignal;
  beforeRename?: () => Promise<void>;
  afterRead?: () => Promise<void>;
  afterListEntry?: () => Promise<void>;
  afterSearchEntry?: () => Promise<void>;
  afterSearchPathAuthorized?: (
    path: string,
    expected: "directory" | "file",
  ) => Promise<void>;
  afterSearchDirectoryRead?: (path: string) => Promise<void>;
}

interface SearchPathIdentity {
  canonicalPath: string;
  device: number;
  inode: number;
}

export class FileTools {
  private canonicalProjectRoot: Promise<string>;
  private readonly canonicalProjectIdentity: Promise<{
    path: string;
    device: number;
    inode: number;
  }>;
  private readonly signal?: AbortSignal;
  private readonly beforeRename?: () => Promise<void>;
  private readonly afterRead?: () => Promise<void>;
  private readonly afterListEntry?: () => Promise<void>;
  private readonly afterSearchEntry?: () => Promise<void>;
  private readonly afterSearchPathAuthorized?: FileToolsOptions["afterSearchPathAuthorized"];
  private readonly afterSearchDirectoryRead?: FileToolsOptions["afterSearchDirectoryRead"];

  constructor(projectRoot: string, options: FileToolsOptions = {}) {
    this.canonicalProjectIdentity = realpath(resolve(projectRoot)).then(
      async (path) => {
        const metadata = await lstat(path);
        return {
          path,
          device: metadata.dev,
          inode: metadata.ino,
        };
      },
    );
    this.canonicalProjectRoot = this.canonicalProjectIdentity.then(
      ({ path }) => path,
    );
    this.signal = options.signal;
    this.beforeRename = options.beforeRename;
    this.afterRead = options.afterRead;
    this.afterListEntry = options.afterListEntry;
    this.afterSearchEntry = options.afterSearchEntry;
    this.afterSearchPathAuthorized =
      options.afterSearchPathAuthorized;
    this.afterSearchDirectoryRead = options.afterSearchDirectoryRead;
  }

  async read(
    path: string,
    approved?: ApprovedFileAccess,
  ): Promise<FileReadResult> {
    this.throwIfAborted();
    const canonicalPath = await this.authorizedPath(
      path,
      "read_file",
      approved,
    );
    this.throwIfAborted();
    const [content, metadata] = await Promise.all([
      readFile(canonicalPath, "utf8"),
      stat(canonicalPath),
    ]);
    await this.afterRead?.();
    this.throwIfAborted();
    return {
      content,
      sha256: sha256(content),
      mtimeMs: metadata.mtimeMs,
      canonicalPath,
    };
  }

  async search(query: string): Promise<SearchMatch[]> {
    this.throwIfAborted();
    if (query.length === 0) {
      return [];
    }
    const projectRoot = await this.canonicalProjectRoot;
    this.throwIfAborted();
    const matches: SearchMatch[] = [];

    const visit = async (
      directory: string,
      allowMissing: boolean,
    ): Promise<void> => {
      if (matches.length >= MAX_SEARCH_RESULTS) {
        return;
      }
      let directoryIdentity: SearchPathIdentity;
      let entries;
      try {
        directoryIdentity = await this.authorizeSearchPath(
          projectRoot,
          directory,
          "directory",
        );
        await this.afterSearchPathAuthorized?.(
          directoryIdentity.canonicalPath,
          "directory",
        );
        this.throwIfAborted();
        const directoryHandle = await this.openVerifiedSearchPath(
          directoryIdentity,
          "directory",
          directory,
        );
        try {
          entries = await readdir(directoryIdentity.canonicalPath, {
            withFileTypes: true,
          });
          await this.afterSearchDirectoryRead?.(
            directoryIdentity.canonicalPath,
          );
          this.throwIfAborted();
          await this.revalidateSearchPath(
            projectRoot,
            directoryIdentity,
            "directory",
            directory,
          );
          const handleMetadata = await directoryHandle.stat();
          if (
            handleMetadata.dev !== directoryIdentity.device ||
            handleMetadata.ino !== directoryIdentity.inode ||
            !handleMetadata.isDirectory()
          ) {
            throw new PathOutsideProjectError(directory);
          }
        } finally {
          await directoryHandle.close();
        }
      } catch (error) {
        if (allowMissing && this.isBenignSearchEntryError(error)) {
          return;
        }
        throw error;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));

      for (const entry of entries) {
        if (matches.length >= MAX_SEARCH_RESULTS) {
          return;
        }
        if (entry.isSymbolicLink()) {
          continue;
        }
        const absolutePath = resolve(
          directoryIdentity.canonicalPath,
          entry.name,
        );
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) {
            await visit(absolutePath, true);
          }
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }

        let content: string;
        let fileIdentity: SearchPathIdentity;
        try {
          fileIdentity = await this.authorizeSearchPath(
            projectRoot,
            absolutePath,
            "file",
          );
          await this.afterSearchPathAuthorized?.(
            fileIdentity.canonicalPath,
            "file",
          );
          this.throwIfAborted();
          const fileHandle = await this.openVerifiedSearchPath(
            fileIdentity,
            "file",
            absolutePath,
          );
          try {
            content = await fileHandle.readFile("utf8");
            await this.afterSearchEntry?.();
            this.throwIfAborted();
            await this.revalidateSearchPath(
              projectRoot,
              fileIdentity,
              "file",
              absolutePath,
            );
            const handleMetadata = await fileHandle.stat();
            if (
              handleMetadata.dev !== fileIdentity.device ||
              handleMetadata.ino !== fileIdentity.inode ||
              !handleMetadata.isFile()
            ) {
              throw new PathOutsideProjectError(absolutePath);
            }
          } finally {
            await fileHandle.close();
          }
        } catch (error) {
          if (
            error instanceof PathOutsideProjectError ||
            this.signal?.aborted ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            throw error;
          }
          if (this.isBenignSearchEntryError(error)) continue;
          throw error;
        }
        if (content.includes("\0")) {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const column = lines[index].indexOf(query);
          if (column >= 0) {
            matches.push({
              path: relative(projectRoot, fileIdentity.canonicalPath),
              line: index + 1,
              column: column + 1,
              preview: lines[index].trim(),
            });
            if (matches.length >= MAX_SEARCH_RESULTS) {
              return;
            }
          }
        }
      }
    };

    await visit(projectRoot, false);
    return matches;
  }

  async list(path = "."): Promise<string[]> {
    this.throwIfAborted();
    const projectRoot = await this.canonicalProjectRoot;
    const requestedPath = isAbsolute(path) ? path : resolve(projectRoot, path);
    const canonicalPath = await canonicalizePath(requestedPath);
    if (!isPathContained(canonicalPath, projectRoot)) {
      throw new PathOutsideProjectError(path);
    }
    this.throwIfAborted();

    const lexicalPath = resolve(requestedPath);
    if (!isPathContained(lexicalPath, projectRoot)) {
      throw new PathOutsideProjectError(path);
    }
    const requestedRelative = relative(projectRoot, lexicalPath);
    const requestedSegments =
      requestedRelative === "" ? [] : requestedRelative.split(sep);
    if (
      requestedSegments.some((segment) =>
        IGNORED_DIRECTORIES.has(segment),
      )
    ) {
      return [];
    }
    let requestedMetadata = await lstat(projectRoot);
    let cursor = projectRoot;
    for (const segment of requestedSegments) {
      cursor = resolve(cursor, segment);
      requestedMetadata = await lstat(cursor);
      this.throwIfAborted();
      if (requestedMetadata.isSymbolicLink()) {
        return [];
      }
    }
    if (requestedMetadata.isFile()) {
      return [relative(projectRoot, canonicalPath)];
    }

    const listed: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      if (listed.length >= MAX_LIST_ENTRIES) {
        return;
      }
      this.throwIfAborted();
      let metadata;
      let canonicalDirectory: string;
      try {
        metadata = await lstat(directory);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
          return;
        }
        canonicalDirectory = await realpath(directory);
      } catch (error) {
        if (
          ["ENOENT", "ENOTDIR", "ELOOP"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        ) {
          return;
        }
        throw error;
      }
      if (!isPathContained(canonicalDirectory, projectRoot)) {
        return;
      }
      this.throwIfAborted();
      const entries = await readdir(canonicalDirectory, {
        withFileTypes: true,
      });
      this.throwIfAborted();
      entries.sort((left, right) => left.name.localeCompare(right.name));

      for (const entry of entries) {
        if (listed.length >= MAX_LIST_ENTRIES) {
          return;
        }
        this.throwIfAborted();
        if (
          entry.isSymbolicLink() ||
          (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name))
        ) {
          continue;
        }
        const absolutePath = resolve(canonicalDirectory, entry.name);
        if (!entry.isDirectory() && !entry.isFile()) {
          continue;
        }
        listed.push(relative(projectRoot, absolutePath));
        await this.afterListEntry?.();
        this.throwIfAborted();
        if (entry.isDirectory()) {
          await visit(absolutePath);
        }
      }
    };

    await visit(canonicalPath);
    return listed.sort((left, right) => left.localeCompare(right));
  }

  async writeAtomic(
    path: string,
    content: string,
    expectedSha256: string | null,
    approved?: ApprovedFileAccess,
  ): Promise<FileWriteResult> {
    this.throwIfAborted();
    const projectRoot = await this.canonicalProjectRoot;
    this.throwIfAborted();
    const canonicalPath = await this.authorizedPath(
      path,
      "write_file",
      approved,
    );
    this.throwIfAborted();

    let before = "";
    let mode = 0o644;
    try {
      before = await readFile(canonicalPath, "utf8");
      mode = (await lstat(canonicalPath)).mode;
      this.throwIfAborted();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const beforeSha256 = sha256(before);
    if (
      expectedSha256 !== null &&
      beforeSha256 !== expectedSha256
    ) {
      throw new FileConflictError(path);
    }

    await mkdir(dirname(canonicalPath), { recursive: true });
    this.throwIfAborted();
    const temporaryPath = resolve(
      dirname(canonicalPath),
      `.${basename(canonicalPath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryPath, content, { mode });
      await this.beforeRename?.();
      this.throwIfAborted();
      await rename(temporaryPath, canonicalPath);
    } catch (error) {
      if (this.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw error;
      }
      try {
        await unlink(temporaryPath);
      } catch {
        // The temporary file may not have been created or may already be renamed.
      }
      throw error;
    }

    const displayPath = relative(projectRoot, canonicalPath);
    return {
      path: displayPath,
      patch: this.diff(displayPath, before, content),
      beforeSha256,
      afterSha256: sha256(content),
    };
  }

  diff(path: string, before: string, after: string): string {
    return unifiedDiff(path, before, after);
  }

  private async authorizedPath(
    path: string,
    kind: ApprovedFileAccess["kind"],
    approved?: ApprovedFileAccess,
  ): Promise<string> {
    const projectRoot = await this.canonicalProjectRoot;
    const requestedPath = isAbsolute(path) ? path : resolve(projectRoot, path);
    const canonicalPath = await canonicalizePath(requestedPath);
    const isContained = isPathContained(canonicalPath, projectRoot);
    const isNarrowlyApproved =
      approved?.kind === kind && approved.canonicalPath === canonicalPath;
    if (!isContained && !isNarrowlyApproved) {
      throw new PathOutsideProjectError(path);
    }
    return canonicalPath;
  }

  private async authorizeSearchPath(
    projectRoot: string,
    path: string,
    expected: "directory" | "file",
  ): Promise<SearchPathIdentity> {
    this.throwIfAborted();
    const identity = await this.canonicalProjectIdentity;
    let rootMetadata;
    try {
      rootMetadata = await lstat(projectRoot);
    } catch {
      throw new PathOutsideProjectError(path);
    }
    if (
      rootMetadata.isSymbolicLink() ||
      !rootMetadata.isDirectory() ||
      rootMetadata.dev !== identity.device ||
      rootMetadata.ino !== identity.inode
    ) {
      throw new PathOutsideProjectError(path);
    }

    const lexicalPath = resolve(path);
    if (!isPathContained(lexicalPath, projectRoot)) {
      throw new PathOutsideProjectError(path);
    }
    const relativePath = relative(projectRoot, lexicalPath);
    let cursor = projectRoot;
    let metadata = rootMetadata;
    for (const segment of relativePath === "" ? [] : relativePath.split(sep)) {
      cursor = resolve(cursor, segment);
      try {
        metadata = await lstat(cursor);
      } catch (error) {
        if (
          ["ELOOP", "ENOTDIR"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        ) {
          throw new PathOutsideProjectError(path);
        }
        throw error;
      }
      if (metadata.isSymbolicLink()) {
        throw new PathOutsideProjectError(path);
      }
    }
    const canonicalPath = await realpath(lexicalPath);
    if (
      canonicalPath !== lexicalPath ||
      !isPathContained(canonicalPath, projectRoot) ||
      (expected === "directory"
        ? !metadata.isDirectory()
        : !metadata.isFile())
    ) {
      throw new PathOutsideProjectError(path);
    }
    this.throwIfAborted();
    return {
      canonicalPath,
      device: metadata.dev,
      inode: metadata.ino,
    };
  }

  private async openVerifiedSearchPath(
    identity: SearchPathIdentity,
    expected: "directory" | "file",
    displayPath: string,
  ) {
    let handle;
    try {
      const flags =
        fsConstants.O_RDONLY |
        fsConstants.O_NOFOLLOW |
        (expected === "directory" ? fsConstants.O_DIRECTORY : 0);
      handle = await open(identity.canonicalPath, flags);
    } catch (error) {
      if (
        ["ELOOP", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        throw new PathOutsideProjectError(displayPath);
      }
      throw error;
    }
    try {
      const metadata = await handle.stat();
      if (
        metadata.dev !== identity.device ||
        metadata.ino !== identity.inode ||
        (expected === "directory"
          ? !metadata.isDirectory()
          : !metadata.isFile())
      ) {
        throw new PathOutsideProjectError(displayPath);
      }
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  private async revalidateSearchPath(
    projectRoot: string,
    identity: SearchPathIdentity,
    expected: "directory" | "file",
    displayPath: string,
  ): Promise<void> {
    const current = await this.authorizeSearchPath(
      projectRoot,
      identity.canonicalPath,
      expected,
    );
    if (
      current.device !== identity.device ||
      current.inode !== identity.inode
    ) {
      throw new PathOutsideProjectError(displayPath);
    }
  }

  private isBenignSearchEntryError(error: unknown): boolean {
    return ["ENOENT", "EACCES", "EPERM"].includes(
      (error as NodeJS.ErrnoException).code ?? "",
    );
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  }
}
