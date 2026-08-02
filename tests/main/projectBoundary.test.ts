import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authorizeProjectPath } from "../../src/main/projects/projectBoundary";

describe("authorizeProjectPath", () => {
  let temporaryRoot: string;
  let projectsRoot: string;
  let verifiedProjectsRoot: string;
  let sibling: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "zorocoding-boundary-"));
    projectsRoot = path.join(temporaryRoot, "ZoroCodingData", "Projects");
    sibling = path.join(temporaryRoot, "outside-project");
    await Promise.all([mkdir(path.join(projectsRoot, "demo"), { recursive: true }), mkdir(sibling)]);
    verifiedProjectsRoot = await realpath(projectsRoot);
  });

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("accepts the Projects root and real descendants", async () => {
    await expect(
      authorizeProjectPath(projectsRoot, projectsRoot, verifiedProjectsRoot),
    ).resolves.toBe(await realpath(projectsRoot));
    await expect(
      authorizeProjectPath(
        projectsRoot,
        path.join(projectsRoot, "demo"),
        verifiedProjectsRoot,
      ),
    ).resolves.toBe(await realpath(path.join(projectsRoot, "demo")));
  });

  it("rejects a sibling directory", async () => {
    await expect(
      authorizeProjectPath(projectsRoot, sibling, verifiedProjectsRoot),
    ).rejects.toThrow("Projects");
  });

  it("rejects a symlink inside Projects that resolves outside", async () => {
    await symlink(sibling, path.join(projectsRoot, "escape"));

    await expect(
      authorizeProjectPath(
        projectsRoot,
        path.join(projectsRoot, "escape"),
        verifiedProjectsRoot,
      ),
    ).rejects.toThrow("Projects");
  });

  it("rejects Projects after its configured path is replaced with an escape symlink", async () => {
    await rm(projectsRoot, { recursive: true });
    await symlink(sibling, projectsRoot);

    await expect(
      authorizeProjectPath(projectsRoot, projectsRoot, verifiedProjectsRoot),
    ).rejects.toThrow("Projects");
  });
});
