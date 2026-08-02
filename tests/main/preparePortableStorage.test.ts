import path from "node:path";
import { chmod, mkdir, mkdtemp, readFile, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { preparePortableStorage, validatePortableRoot } from "../../src/main/portable/preparePortableStorage";
import type { PortableLayout } from "../../src/main/portable/portableLayout";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "zorocoding-portable-"));
}

function layoutUnder(volumeRoot: string): PortableLayout {
  const dataRoot = path.join(volumeRoot, "ZoroCodingData");
  const appDataRoot = path.join(dataRoot, "AppData");
  return {
    volumeRoot,
    dataRoot,
    appDataRoot,
    projectsRoot: path.join(dataRoot, "Projects"),
    logsRoot: path.join(appDataRoot, "logs"),
    backupsRoot: path.join(appDataRoot, "backups"),
  };
}

describe("preparePortableStorage", () => {
  it("creates the complete portable layout with private permissions", async () => {
    const layout = layoutUnder(await temporaryDirectory());
    await preparePortableStorage(layout);
    for (const directory of [
      layout.dataRoot,
      layout.appDataRoot,
      layout.projectsRoot,
      layout.logsRoot,
      layout.backupsRoot,
    ]) {
      expect((await stat(directory)).isDirectory()).toBe(true);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    }
  });

  it("copies legacy data only when the portable destination is empty", async () => {
    const legacy = await temporaryDirectory();
    const layout = layoutUnder(await temporaryDirectory());
    await writeFile(path.join(legacy, "zorocoding.sqlite"), "legacy");
    await preparePortableStorage(layout, legacy);
    expect(await readFile(path.join(layout.appDataRoot, "zorocoding.sqlite"), "utf8"))
      .toBe("legacy");
    await writeFile(path.join(layout.appDataRoot, "zorocoding.sqlite"), "portable");
    await preparePortableStorage(layout, legacy);
    expect(await readFile(path.join(layout.appDataRoot, "zorocoding.sqlite"), "utf8"))
      .toBe("portable");
  });

  it("copies only approved legacy sidecars and secrets without removing the legacy source", async () => {
    const legacy = await temporaryDirectory();
    const layout = layoutUnder(await temporaryDirectory());
    await writeFile(path.join(legacy, "zorocoding.sqlite-wal"), "wal");
    await writeFile(path.join(legacy, "zorocoding.sqlite-shm"), "shm");
    await writeFile(path.join(legacy, "unapproved.txt"), "leave behind");
    await mkdir(path.join(legacy, "secrets"));
    await writeFile(path.join(legacy, "secrets", "provider.json"), "secret");

    await preparePortableStorage(layout, legacy);

    await expect(readFile(path.join(layout.appDataRoot, "zorocoding.sqlite-wal"), "utf8"))
      .resolves.toBe("wal");
    await expect(readFile(path.join(layout.appDataRoot, "zorocoding.sqlite-shm"), "utf8"))
      .resolves.toBe("shm");
    await expect(readFile(path.join(layout.appDataRoot, "secrets", "provider.json"), "utf8"))
      .resolves.toBe("secret");
    await expect(stat(path.join(layout.appDataRoot, "unapproved.txt"))).rejects.toThrow();
    await expect(readFile(path.join(legacy, "unapproved.txt"), "utf8")).resolves.toBe("leave behind");
    await expect(readFile(path.join(legacy, "secrets", "provider.json"), "utf8")).resolves.toBe("secret");
  });

  it("rejects a data root whose real path escapes the selected volume", async () => {
    const volume = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await chmod(outside, 0o755);
    await symlink(outside, path.join(volume, "ZoroCodingData"));
    await expect(preparePortableStorage(layoutUnder(volume))).rejects.toThrow("真实路径");
    await expect(stat(path.join(outside, "AppData"))).rejects.toThrow();
    expect((await stat(outside)).mode & 0o777).toBe(0o755);
  });

  it("rejects app data redirected outside the selected volume", async () => {
    const volume = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await mkdir(path.join(volume, "ZoroCodingData"));
    await symlink(outside, path.join(volume, "ZoroCodingData", "AppData"));
    await expect(preparePortableStorage(layoutUnder(volume))).rejects.toThrow("真实路径");
  });

  it("rejects a layout with roots that differ from the fixed portable structure", async () => {
    const volume = await temporaryDirectory();
    const layout = layoutUnder(volume);
    layout.appDataRoot = path.join(volume, "Elsewhere");
    await expect(preparePortableStorage(layout)).rejects.toThrow("固定");
    await expect(stat(layout.appDataRoot)).rejects.toThrow();
  });

  it("rejects managed roots that cross a device boundary", () => {
    expect(() => validatePortableRoot("/Volumes/ORICO", "/Volumes/ORICO/ZoroCodingData", 100, 101))
      .toThrow("设备");
  });

  it("hardens the opened directory rather than re-following a replaced pathname", async () => {
    const volume = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const layout = layoutUnder(volume);
    await mkdir(layout.dataRoot);
    await chmod(layout.dataRoot, 0o755);
    await chmod(outside, 0o755);

    await preparePortableStorage(layout, undefined, {
      afterDirectoriesOpened: async () => {
        await rename(layout.dataRoot, path.join(volume, "original-data"));
        await symlink(outside, layout.dataRoot);
      },
    });

    expect((await stat(path.join(volume, "original-data"))).mode & 0o777).toBe(0o700);
    expect((await stat(outside)).mode & 0o777).toBe(0o755);
  });

  it("rejects non-normalized layout paths before a symlink-plus-parent traversal can escape", async () => {
    const volume = await temporaryDirectory();
    const outsideParent = await temporaryDirectory();
    const outside = path.join(outsideParent, "outside");
    const layout = layoutUnder(volume);
    await mkdir(outside);
    await symlink(outside, path.join(volume, "escape"));
    layout.dataRoot = `${volume}/escape/../ZoroCodingData`;

    await expect(preparePortableStorage(layout)).rejects.toThrow("固定");
    await expect(stat(path.join(outsideParent, "ZoroCodingData"))).rejects.toThrow();
  });

  it("rejects a non-normalized volume root before creating portable storage", async () => {
    const volume = await temporaryDirectory();
    const layout = layoutUnder(volume);
    layout.volumeRoot = `${volume}/.`;

    await expect(preparePortableStorage(layout)).rejects.toThrow("固定");
    await expect(stat(layout.dataRoot)).rejects.toThrow();
  });
});
