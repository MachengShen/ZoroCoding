import { describe, expect, it, vi } from "vitest";

import { installWindowSafetyHandlers } from "../../src/main/windowSafety";

describe("window task safety", () => {
  function harness() {
    const listeners = new Map<string, (...arguments_: unknown[]) => void>();
    const webContentsListeners = new Map<
      string,
      (...arguments_: unknown[]) => void
    >();
    const window = {
      on: vi.fn((event: string, listener: (...arguments_: unknown[]) => void) => {
        listeners.set(event, listener);
      }),
      webContents: {
        on: vi.fn(
          (
            event: string,
            listener: (...arguments_: unknown[]) => void,
          ) => {
            webContentsListeners.set(event, listener);
          },
        ),
      },
      destroy: vi.fn(),
    };
    const runtime = {
      pauseActiveTasks: vi.fn(async () => {}),
    };
    installWindowSafetyHandlers(window, () => runtime);
    return { listeners, webContentsListeners, runtime, window };
  }

  it("pauses active work before a normal window close", async () => {
    const { listeners, runtime, window } = harness();
    const preventDefault = vi.fn();

    listeners.get("close")?.({ preventDefault });
    await Promise.resolve();
    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(runtime.pauseActiveTasks).toHaveBeenCalledOnce();
    expect(window.destroy).toHaveBeenCalledOnce();
  });

  it("pauses active work after the renderer process exits", async () => {
    const { webContentsListeners, runtime } = harness();

    webContentsListeners.get("render-process-gone")?.();
    await Promise.resolve();

    expect(runtime.pauseActiveTasks).toHaveBeenCalledOnce();
  });

  it("pauses active work when the window becomes unresponsive", async () => {
    const { listeners, runtime } = harness();

    listeners.get("unresponsive")?.();
    await Promise.resolve();

    expect(runtime.pauseActiveTasks).toHaveBeenCalledOnce();
  });

  it("reports a pause failure after a renderer crash without an unhandled rejection", async () => {
    const { webContentsListeners, runtime } = harness();
    const failure = new Error("database unavailable");
    runtime.pauseActiveTasks.mockRejectedValueOnce(failure);
    const report = vi.spyOn(console, "error").mockImplementation(() => {});

    webContentsListeners.get("render-process-gone")?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(report).toHaveBeenCalledWith(
      "ZoroCoding 无法在窗口异常后暂停活动任务。",
      failure,
    );
    report.mockRestore();
  });
});
