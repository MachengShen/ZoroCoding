import { constants } from "node:fs";
import { copyFile, cp, lstat, mkdir, open, realpath, stat, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { isCanonicalDescendant, type PortableLayout } from "./portableLayout";

const legacyFiles = [
  "zorocoding.sqlite",
  "zorocoding.sqlite-wal",
  "zorocoding.sqlite-shm",
];

export async function preparePortableStorage(
  layout: PortableLayout,
  legacyUserData?: string,
  options: PortableStoragePreparationOptions = {},
): Promise<void> {
  if (layout.volumeRoot !== path.resolve(layout.volumeRoot)) {
    throw new Error("移动硬盘布局必须使用固定目录结构。");
  }
  assertFixedLayout(layout);

  const realVolume = await realpath(layout.volumeRoot);
  const volumeHandle = await open(realVolume, constants.O_RDONLY | constants.O_DIRECTORY);
  let volumeDevice: number;
  try {
    volumeDevice = (await volumeHandle.stat()).dev;
  } finally {
    await volumeHandle.close();
  }
  const managedDirectories = fixedDirectories(layout, realVolume);
  const handles: FileHandle[] = [];
  try {
    for (const { directory, expectedRealPath } of managedDirectories) {
      handles.push(await openPortableDirectory(directory, expectedRealPath, realVolume, volumeDevice));
    }

    const probe = path.join(layout.appDataRoot, `.write-probe-${randomUUID()}`);
    await writeFile(probe, "ok", { mode: 0o600, flag: "wx" });
    await unlink(probe);

    await options.afterDirectoriesOpened?.();
    await Promise.all(handles.map((handle) => handle.chmod(0o700)));

    if (legacyUserData !== undefined) {
      await migrateLegacyData(legacyUserData, layout.appDataRoot);
    }
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
  }
}

export interface PortableStoragePreparationOptions {
  afterDirectoriesOpened?: () => Promise<void> | void;
}

function assertFixedLayout(layout: PortableLayout): void {
  const dataRoot = path.join(layout.volumeRoot, "ZoroCodingData");
  const appDataRoot = path.join(dataRoot, "AppData");
  const expected = [
    [layout.dataRoot, dataRoot],
    [layout.appDataRoot, appDataRoot],
    [layout.projectsRoot, path.join(dataRoot, "Projects")],
    [layout.logsRoot, path.join(appDataRoot, "logs")],
    [layout.backupsRoot, path.join(appDataRoot, "backups")],
  ];
  if (expected.some(([actual, intended]) =>
    path.normalize(actual) !== actual || path.normalize(intended) !== intended || actual !== intended,
  )) {
    throw new Error("移动硬盘布局必须使用固定目录结构。");
  }
}

function fixedDirectories(layout: PortableLayout, realVolume: string): Array<{
  directory: string;
  expectedRealPath: string;
}> {
  const dataRoot = path.join(realVolume, "ZoroCodingData");
  const appDataRoot = path.join(dataRoot, "AppData");
  return [
    { directory: layout.dataRoot, expectedRealPath: dataRoot },
    { directory: layout.appDataRoot, expectedRealPath: appDataRoot },
    { directory: layout.projectsRoot, expectedRealPath: path.join(dataRoot, "Projects") },
    { directory: layout.logsRoot, expectedRealPath: path.join(appDataRoot, "logs") },
    { directory: layout.backupsRoot, expectedRealPath: path.join(appDataRoot, "backups") },
  ];
}

async function openPortableDirectory(
  directory: string,
  expectedRealPath: string,
  realVolume: string,
  volumeDevice: number,
): Promise<FileHandle> {
  let entry;
  try {
    entry = await lstat(directory);
  } catch (error: unknown) {
    if (!isNotFound(error)) {
      throw error;
    }
    await mkdir(directory, { mode: 0o700 });
    entry = await lstat(directory);
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error("ZoroCodingData 的真实路径离开了移动硬盘。");
  }

  let handle: FileHandle;
  try {
    handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null &&
        "code" in error && (error.code === "ELOOP" || error.code === "ENOTDIR")) {
      throw new Error("ZoroCodingData 的真实路径离开了移动硬盘。");
    }
    throw error;
  }
  try {
    const realDirectory = await realpath(directory);
    const [handleEntry, resolvedEntry] = await Promise.all([handle.stat(), stat(realDirectory)]);
    if (handleEntry.dev !== resolvedEntry.dev || handleEntry.ino !== resolvedEntry.ino) {
      throw new Error("ZoroCodingData 的真实路径离开了移动硬盘。");
    }
    validatePortableRoot(
      realVolume,
      realDirectory,
      volumeDevice,
      handleEntry.dev,
      expectedRealPath,
    );
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export function validatePortableRoot(
  realVolume: string,
  realDirectory: string,
  volumeDevice: number,
  directoryDevice: number,
  expectedRealPath?: string,
): void {
  if (!isCanonicalDescendant(realVolume, realDirectory)) {
    throw new Error("ZoroCodingData 的真实路径离开了移动硬盘。");
  }
  if (expectedRealPath !== undefined && realDirectory !== expectedRealPath) {
    throw new Error("移动硬盘布局必须使用固定目录结构。");
  }
  if (directoryDevice !== volumeDevice) {
    throw new Error("ZoroCodingData 跨越了移动硬盘设备边界。");
  }
}

async function migrateLegacyData(legacyUserData: string, appDataRoot: string): Promise<void> {
  for (const fileName of legacyFiles) {
    const source = path.join(legacyUserData, fileName);
    const target = path.join(appDataRoot, fileName);
    if (await exists(source) && !await exists(target)) {
      await copyFile(source, target, constants.COPYFILE_EXCL);
    }
  }

  const sourceSecrets = path.join(legacyUserData, "secrets");
  const targetSecrets = path.join(appDataRoot, "secrets");
  if ((await isDirectory(sourceSecrets)) && !await exists(targetSecrets)) {
    await cp(sourceSecrets, targetSecrets, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isDirectory();
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "ENOENT";
}
