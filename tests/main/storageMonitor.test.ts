import { describe, expect, it, vi } from "vitest";

import { startStorageMonitor } from "../../src/main/portable/storageMonitor";

describe("startStorageMonitor", () => {
  it("notifies only when storage availability changes", async () => {
    const checks = [true, true, false, false, true];
    const unavailable = vi.fn();
    const restored = vi.fn();
    let checkNow: (() => Promise<void>) | undefined;

    const stop = startStorageMonitor({
      appDataRoot: "/portable/AppData",
      projectsRoot: "/portable/Projects",
      check: async () => checks.shift() ?? true,
      onUnavailable: unavailable,
      onRestored: restored,
      schedule: (callback) => {
        checkNow = callback;
        return 1;
      },
      clearSchedule: () => {},
    });

    await checkNow?.();
    await checkNow?.();
    await checkNow?.();
    await checkNow?.();
    await checkNow?.();

    expect(unavailable).toHaveBeenCalledOnce();
    expect(restored).toHaveBeenCalledOnce();
    stop();
  });

  it("does not overlap checks and clears the production interval on stop", async () => {
    let resolveCheck: ((available: boolean) => void) | undefined;
    const check = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    let checkNow: (() => Promise<void>) | undefined;
    const clearSchedule = vi.fn();

    const stop = startStorageMonitor({
      appDataRoot: "/portable/AppData",
      projectsRoot: "/portable/Projects",
      check,
      onUnavailable: () => {},
      onRestored: () => {},
      schedule: (callback, delayMs) => {
        expect(delayMs).toBe(3_000);
        checkNow = callback;
        return 42;
      },
      clearSchedule,
    });

    const first = checkNow?.();
    const second = checkNow?.();
    expect(check).toHaveBeenCalledOnce();
    resolveCheck?.(true);
    await first;
    await second;

    stop();
    expect(clearSchedule).toHaveBeenCalledWith(42);
  });

  it("contains rejected transition callbacks without changing state", async () => {
    const onError = vi.fn();
    let checkNow: (() => Promise<void>) | undefined;
    startStorageMonitor({
      appDataRoot: "/portable/AppData",
      projectsRoot: "/portable/Projects",
      check: async () => false,
      onUnavailable: async () => { throw new Error("cancel failed"); },
      onRestored: () => {},
      onError,
      schedule: (callback) => (checkNow = callback, 1),
      clearSchedule: () => {},
    });
    await checkNow?.();
    await checkNow?.();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("suppresses an in-flight check after stop", async () => {
    let resolveCheck: ((value: boolean) => void) | undefined;
    let checkNow: (() => Promise<void>) | undefined;
    const unavailable = vi.fn();
    const stop = startStorageMonitor({
      appDataRoot: "/portable/AppData", projectsRoot: "/portable/Projects",
      check: () => new Promise((resolve) => { resolveCheck = resolve; }),
      onUnavailable: unavailable, onRestored: () => {},
      schedule: (callback) => (checkNow = callback, 1), clearSchedule: () => {},
    });
    const running = checkNow?.();
    stop();
    resolveCheck?.(false);
    await running;
    expect(unavailable).not.toHaveBeenCalled();
  });

  it("contains a throwing error reporter exactly once", async () => {
    let checkNow: (() => Promise<void>) | undefined;
    const reporter = vi.fn(() => { throw new Error("reporter failure"); });
    startStorageMonitor({
      appDataRoot: "/portable/AppData", projectsRoot: "/portable/Projects",
      check: async () => { throw new Error("check failure"); },
      onUnavailable: () => {}, onRestored: () => {}, onError: reporter,
      schedule: (callback) => (checkNow = callback, 1), clearSchedule: () => {},
    });
    await expect(checkNow?.()).resolves.toBeUndefined();
    expect(reporter).toHaveBeenCalledOnce();
  });
});
