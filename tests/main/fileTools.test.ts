import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FileConflictError,
  FileTools,
  PathOutsideProjectError,
} from "../../src/main/tools/fileTools";

describe("FileTools", () => {
  let project: string;
  let files: FileTools;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "zorocoding-files-"));
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src", "a.ts"), "const value = 1;\n");
    files = new FileTools(project);
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it("reads a project file with a stable hash and modification time", async () => {
    const result = await files.read("src/a.ts");

    expect(result.content).toBe("const value = 1;\n");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.mtimeMs).toBeGreaterThan(0);
    expect(result.canonicalPath).toBe(
      await realpath(join(project, "src", "a.ts")),
    );
  });

  it("refuses to overwrite a file changed after it was read", async () => {
    const read = await files.read("src/a.ts");
    await writeFile(join(project, "src", "a.ts"), "external change\n");

    await expect(
      files.writeAtomic("src/a.ts", "agent change\n", read.sha256),
    ).rejects.toBeInstanceOf(FileConflictError);
    await expect(
      files.writeAtomic("src/a.ts", "agent change\n", read.sha256),
    ).rejects.toMatchObject({ code: "file_conflict" });
  });

  it("atomically writes content and returns a readable unified diff", async () => {
    const read = await files.read("src/a.ts");

    const result = await files.writeAtomic(
      "src/a.ts",
      "const value = 2;\n",
      read.sha256,
    );

    expect(await readFile(join(project, "src", "a.ts"), "utf8")).toBe(
      "const value = 2;\n",
    );
    expect(result.beforeSha256).toBe(read.sha256);
    expect(result.afterSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.patch).toContain("-const value = 1;");
    expect(result.patch).toContain("+const value = 2;");
  });

  it("does not rename a temporary write after cancellation", async () => {
    const controller = new AbortController();
    let releaseRename: (() => void) | undefined;
    files = new FileTools(project, {
      signal: controller.signal,
      beforeRename: () => new Promise<void>((resolve) => { releaseRename = resolve; }),
    });
    const pending = files.writeAtomic("src/a.ts", "canceled\n", null);
    while (releaseRename === undefined) await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    releaseRename();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(await readFile(join(project, "src", "a.ts"), "utf8")).toBe("const value = 1;\n");
    const temporaryFiles = (await readdir(join(project, "src"))).filter(
      (entry) => entry.startsWith(".a.ts.") && entry.endsWith(".tmp"),
    );
    expect(temporaryFiles).toHaveLength(1);
  });

  it("rejects an in-flight read when its abort signal closes", async () => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    files = new FileTools(project, { signal: controller.signal, afterRead: () => new Promise<void>((resolve) => { release = resolve; }) });
    const pending = files.read("src/a.ts");
    while (release === undefined) await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects an in-flight search and stops traversal when its abort signal closes", async () => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    await writeFile(join(project, "src", "b.ts"), "needle");
    files = new FileTools(project, { signal: controller.signal, afterSearchEntry: () => new Promise<void>((resolve) => { release = resolve; }) });
    const pending = files.search("needle");
    while (release === undefined) await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects search when the authorized project root is replaced before a later read", async () => {
    const outside = await mkdtemp(join(tmpdir(), "zorocoding-outside-search-root-"));
    const original = `${project}-original`;
    await writeFile(join(project, "0-trigger.txt"), "inside\n");
    await writeFile(join(project, "leak.txt"), "inside\n");
    await writeFile(join(outside, "leak.txt"), "needle-outside\n");
    let swapped = false;
    files = new FileTools(project, {
      afterSearchEntry: async () => {
        if (swapped) return;
        swapped = true;
        await rename(project, original);
        await symlink(outside, project);
      },
    });

    try {
      await expect(files.search("needle-outside")).rejects.toBeInstanceOf(
        PathOutsideProjectError,
      );
    } finally {
      await rm(project, { force: true });
      await rename(original, project);
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects search when a traversed directory is replaced by an outside symlink", async () => {
    const outside = await mkdtemp(join(tmpdir(), "zorocoding-outside-search-nested-"));
    await mkdir(join(project, "race"));
    await writeFile(join(project, "race", "0-trigger.txt"), "inside\n");
    await writeFile(join(project, "race", "leak.txt"), "inside\n");
    await writeFile(join(outside, "leak.txt"), "needle-outside\n");
    let swapped = false;
    files = new FileTools(project, {
      afterSearchEntry: async () => {
        if (swapped) return;
        swapped = true;
        await rename(join(project, "race"), join(project, "race-original"));
        await symlink(outside, join(project, "race"));
      },
    });

    try {
      await expect(files.search("needle-outside")).rejects.toBeInstanceOf(
        PathOutsideProjectError,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a file swapped to an outside symlink after authorization and before open", async () => {
    const outside = await mkdtemp(join(tmpdir(), "zorocoding-outside-search-file-open-"));
    const victim = join(project, "src", "victim.txt");
    const original = join(project, "src", "victim.inside");
    const outsideFile = join(outside, "outside.txt");
    await writeFile(victim, "inside\n");
    await writeFile(outsideFile, "needle-outside\n");
    const canonicalVictim = await realpath(victim);
    let swapped = false;
    files = new FileTools(project, {
      afterSearchPathAuthorized: async (
        path: string,
        expected: "directory" | "file",
      ) => {
        if (swapped || expected !== "file" || path !== canonicalVictim) return;
        swapped = true;
        await rename(victim, original);
        await symlink(outsideFile, victim);
      },
    } as never);

    try {
      await expect(files.search("needle-outside")).rejects.toBeInstanceOf(
        PathOutsideProjectError,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a directory swapped to an outside symlink after authorization and before readdir", async () => {
    const outside = await mkdtemp(join(tmpdir(), "zorocoding-outside-search-directory-open-"));
    const race = join(project, "race");
    const original = join(project, "race-inside");
    await mkdir(race);
    await writeFile(join(race, "inside.txt"), "inside\n");
    await writeFile(join(outside, "outside.txt"), "needle-outside\n");
    const canonicalRace = await realpath(race);
    let swapped = false;
    files = new FileTools(project, {
      afterSearchPathAuthorized: async (
        path: string,
        expected: "directory" | "file",
      ) => {
        if (swapped || expected !== "directory" || path !== canonicalRace) return;
        swapped = true;
        await rename(race, original);
        await symlink(outside, race);
      },
    } as never);

    try {
      await expect(files.search("needle-outside")).rejects.toBeInstanceOf(
        PathOutsideProjectError,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a directory swapped to an outside symlink after readdir and before entries are consumed", async () => {
    const outside = await mkdtemp(join(tmpdir(), "zorocoding-outside-search-directory-read-"));
    const race = join(project, "race");
    const original = join(project, "race-inside");
    await mkdir(race);
    await writeFile(join(race, "inside.txt"), "needle-inside\n");
    await writeFile(join(outside, "outside.txt"), "needle-outside\n");
    const canonicalRace = await realpath(race);
    let swapped = false;
    files = new FileTools(project, {
      afterSearchDirectoryRead: async (path: string) => {
        if (swapped || path !== canonicalRace) return;
        swapped = true;
        await rename(race, original);
        await symlink(outside, race);
      },
    } as never);

    try {
      await expect(files.search("needle")).rejects.toBeInstanceOf(
        PathOutsideProjectError,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("skips a search entry that disappears after readdir", async () => {
    const disappearing = join(project, "src", "vanishing.txt");
    await writeFile(disappearing, "needle\n");
    const canonicalSource = await realpath(join(project, "src"));
    let removed = false;
    files = new FileTools(project, {
      afterSearchDirectoryRead: async (path: string) => {
        if (removed || path !== canonicalSource) return;
        removed = true;
        await rm(disappearing);
      },
    } as never);

    await expect(files.search("needle")).resolves.toEqual([]);
  });

  it("lists sorted project-relative files and directories while ignoring generated trees and symlinks", async () => {
    await mkdir(join(project, "src", "nested"), { recursive: true });
    await writeFile(join(project, "src", "nested", "b.ts"), "export {};\n");
    for (const directory of [".git", "node_modules", "dist", "build"]) {
      await mkdir(join(project, directory), { recursive: true });
      await writeFile(join(project, directory, "hidden.txt"), "hidden\n");
    }
    await symlink(join(project, "src"), join(project, "linked-src"));

    await expect(files.list()).resolves.toEqual([
      "src",
      "src/a.ts",
      "src/nested",
      "src/nested/b.ts",
    ]);
    await expect(files.list("linked-src/nested")).resolves.toEqual([]);
    await expect(files.list("node_modules")).resolves.toEqual([]);
  });

  it("lists a subdirectory with project-relative paths", async () => {
    await mkdir(join(project, "src", "nested"), { recursive: true });
    await writeFile(join(project, "src", "nested", "b.ts"), "export {};\n");

    await expect(files.list("src")).resolves.toEqual([
      "src/a.ts",
      "src/nested",
      "src/nested/b.ts",
    ]);
  });

  it("rejects list roots outside the canonical project", async () => {
    await expect(files.list("..")).rejects.toBeInstanceOf(
      PathOutsideProjectError,
    );
  });

  it("rejects an in-flight list when its abort signal closes", async () => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    files = new FileTools(project, {
      signal: controller.signal,
      afterListEntry: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const pending = files.list();
    while (release === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    controller.abort();
    release();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("discards a directory replaced by an outside symlink before descent", async () => {
    const outside = await mkdtemp(join(tmpdir(), "zorocoding-outside-list-"));
    await mkdir(join(project, "race"));
    await writeFile(join(project, "race", "inside.txt"), "inside\n");
    await writeFile(join(outside, "external-secret.txt"), "outside\n");
    let swapped = false;
    files = new FileTools(project, {
      afterListEntry: async () => {
        if (swapped) {
          return;
        }
        swapped = true;
        await rename(join(project, "race"), join(project, "race-original"));
        await symlink(outside, join(project, "race"));
      },
    });

    try {
      const listed = await files.list();

      expect(listed).toEqual([
        "race",
        "src",
        "src/a.ts",
      ]);
      expect(listed.join("\n")).not.toContain("external-secret.txt");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("caps listed output at 500 entries", async () => {
    await mkdir(join(project, "many"));
    await Promise.all(
      Array.from({ length: 510 }, (_, index) =>
        writeFile(
          join(project, "many", `file-${String(index).padStart(3, "0")}.txt`),
          "",
        ),
      ),
    );

    const listed = await files.list("many");

    expect(listed).toHaveLength(500);
    expect(listed).toEqual([...listed].sort((left, right) =>
      left.localeCompare(right),
    ));
    expect(listed[0]).toBe("many/file-000.txt");
    expect(listed.at(-1)).toBe("many/file-499.txt");
  });

  it("searches project text while ignoring dependencies and build output", async () => {
    await mkdir(join(project, "node_modules", "hidden"), { recursive: true });
    await mkdir(join(project, "dist"), { recursive: true });
    await writeFile(join(project, "src", "visible.ts"), "needle here\n");
    await writeFile(
      join(project, "node_modules", "hidden", "package.js"),
      "needle hidden\n",
    );
    await writeFile(join(project, "dist", "bundle.js"), "needle built\n");

    const matches = await files.search("needle");

    expect(matches).toEqual([
      {
        path: "src/visible.ts",
        line: 1,
        column: 1,
        preview: "needle here",
      },
    ]);
  });
});
