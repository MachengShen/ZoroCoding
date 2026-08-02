import { realpath } from "node:fs/promises";

import { isCanonicalDescendant } from "../portable/portableLayout";

export async function authorizeProjectPath(
  projectsRoot: string,
  selectedPath: string,
  expectedProjectsRoot: string,
): Promise<string> {
  const root = await realpath(projectsRoot);
  if (root !== expectedProjectsRoot) {
    throw new Error("项目必须位于 ZoroCodingData/Projects 内。");
  }
  const candidate = await realpath(selectedPath);
  if (!isCanonicalDescendant(expectedProjectsRoot, candidate)) {
    throw new Error("项目必须位于 ZoroCodingData/Projects 内。");
  }
  return candidate;
}
