import { describe, expect, it } from "vitest";

import { resolvePortableLayout } from "../../src/main/portable/portableLayout";

describe("resolvePortableLayout", () => {
  it("derives data and project roots beside an app installed on an external volume", () => {
    expect(resolvePortableLayout({
      isPackaged: true,
      execPath: "/Volumes/ORICO/ZoroCoding.app/Contents/MacOS/ZoroCoding",
    })).toEqual({
      volumeRoot: "/Volumes/ORICO",
      dataRoot: "/Volumes/ORICO/ZoroCodingData",
      appDataRoot: "/Volumes/ORICO/ZoroCodingData/AppData",
      projectsRoot: "/Volumes/ORICO/ZoroCodingData/Projects",
      logsRoot: "/Volumes/ORICO/ZoroCodingData/AppData/logs",
      backupsRoot: "/Volumes/ORICO/ZoroCodingData/AppData/backups",
    });
  });

  it("rejects a packaged copy on the internal disk", () => {
    expect(() => resolvePortableLayout({
      isPackaged: true,
      execPath: "/Applications/ZoroCoding.app/Contents/MacOS/ZoroCoding",
    })).toThrow("移动硬盘");
  });

  it("rejects nested bundles and bundles with a different name", () => {
    expect(() => resolvePortableLayout({
      isPackaged: true,
      execPath: "/Volumes/ORICO/nested/ZoroCoding.app/Contents/MacOS/ZoroCoding",
    })).toThrow("移动硬盘");
    expect(() => resolvePortableLayout({
      isPackaged: true,
      execPath: "/Volumes/ORICO/Other.app/Contents/MacOS/ZoroCoding",
    })).toThrow("移动硬盘");
  });

  it("rejects an external executable path that canonically resolves to an internal app", () => {
    expect(() => resolvePortableLayout(
      {
        isPackaged: true,
        execPath: "/Volumes/ORICO/ZoroCoding.app/Contents/MacOS/ZoroCoding",
      },
      () => "/Applications/ZoroCoding.app/Contents/MacOS/ZoroCoding",
    )).toThrow("移动硬盘");
  });

  it("uses an explicit portable root only in non-packaged tests", () => {
    expect(resolvePortableLayout({
      isPackaged: false,
      execPath: "/tmp/zorocoding",
      developmentRoot: "/tmp/zoro-portable",
    }).projectsRoot).toBe("/tmp/zoro-portable/ZoroCodingData/Projects");
  });
});
