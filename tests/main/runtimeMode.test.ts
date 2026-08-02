import { describe, expect, it } from "vitest";

import {
  resolveDevelopmentPortableRoot,
  resolveE2eMode,
  resolveE2eStartupDelay,
} from "../../src/main/runtimeMode";

describe("resolveE2eMode", () => {
  it("never enables test secret injection in a packaged application", () => {
    expect(resolveE2eMode(true, true)).toBe(false);
    expect(resolveE2eMode(true, false)).toBe(true);
    expect(resolveE2eMode(false, false)).toBe(false);
  });
});

describe("resolveDevelopmentPortableRoot", () => {
  it("does not let packaged builds use a development portable override", () => {
    expect(resolveDevelopmentPortableRoot(true, "/tmp/override")).toBeUndefined();
    expect(resolveDevelopmentPortableRoot(false, "/tmp/override")).toBe(
      "/tmp/override",
    );
  });
});

describe("resolveE2eStartupDelay", () => {
  it("never enables the startup delay outside unpackaged E2E mode", () => {
    expect(resolveE2eStartupDelay(false, "1500")).toBe(0);
    expect(resolveE2eStartupDelay(false, "not-a-number")).toBe(0);
  });

  it("accepts only a bounded whole-millisecond delay in E2E mode", () => {
    expect(resolveE2eStartupDelay(true, "1500")).toBe(1_500);
    expect(resolveE2eStartupDelay(true, undefined)).toBe(0);
    expect(resolveE2eStartupDelay(true, "-1")).toBe(0);
    expect(resolveE2eStartupDelay(true, "1.5")).toBe(0);
    expect(resolveE2eStartupDelay(true, "10001")).toBe(0);
  });
});
