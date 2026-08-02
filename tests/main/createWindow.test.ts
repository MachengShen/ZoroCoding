import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildWindowOptions,
  configureWebContentsSecurity,
} from "../../src/main/createWindow";

describe("buildWindowOptions", () => {
  it("isolates and sandboxes the renderer", () => {
    const options = buildWindowOptions("/tmp/zoro-preload.js");

    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: "/tmp/zoro-preload.js",
    });
  });

  it("uses the approved desktop window dimensions", () => {
    const options = buildWindowOptions("/tmp/zoro-preload.js");

    expect(options).toMatchObject({
      width: 1360,
      height: 860,
      minWidth: 900,
      minHeight: 620,
      titleBarStyle: "hiddenInset",
      backgroundColor: "#000000",
    });
  });

  it("denies renderer permission requests and all in-app navigation", () => {
    let permissionRequest:
      | ((webContents: unknown, permission: string, callback: (allowed: boolean) => void) => void)
      | undefined;
    let permissionCheck:
      | ((webContents: unknown, permission: string) => boolean)
      | undefined;
    let openHandler:
      | ((details: { url: string }) => { action: "deny" })
      | undefined;
    const navigate = vi.fn();
    const openExternal = vi.fn(async () => {});
    const webContents = {
      session: {
        setPermissionRequestHandler: vi.fn((handler) => {
          permissionRequest = handler;
        }),
        setPermissionCheckHandler: vi.fn((handler) => {
          permissionCheck = handler;
        }),
      },
      setWindowOpenHandler: vi.fn((handler) => {
        openHandler = handler;
      }),
      on: vi.fn((event, handler) => {
        if (event === "will-navigate") {
          navigate.mockImplementation(handler);
        }
      }),
    };

    configureWebContentsSecurity(
      webContents as never,
      openExternal,
    );
    const callback = vi.fn();
    permissionRequest?.({}, "camera", callback);
    const preventDefault = vi.fn();
    navigate({ preventDefault });

    expect(callback).toHaveBeenCalledWith(false);
    expect(permissionCheck?.({}, "camera")).toBe(false);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openHandler?.({ url: "https://example.com" })).toEqual({
      action: "deny",
    });
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
    expect(openHandler?.({ url: "http://example.com" })).toEqual({
      action: "deny",
    });
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it("ships a restrictive renderer content security policy", async () => {
    const html = await readFile(resolve("index.html"), "utf8");

    expect(html).toContain("default-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("frame-src 'none'");
  });
});
