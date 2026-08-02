import path from "node:path";
import { realpathSync } from "node:fs";

export interface PortableLayoutInput {
  isPackaged: boolean;
  execPath: string;
  developmentRoot?: string;
}

export interface PortableLayout {
  volumeRoot: string;
  dataRoot: string;
  appDataRoot: string;
  projectsRoot: string;
  logsRoot: string;
  backupsRoot: string;
}

export function isCanonicalDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function resolvePortableLayout(
  input: PortableLayoutInput,
  canonicalizePath: (target: string) => string = canonicalizeExistingPath,
): PortableLayout {
  const executablePath = input.isPackaged
    ? canonicalizePath(path.resolve(input.execPath))
    : undefined;
  const packagedMatch = executablePath?.match(
    /^\/Volumes\/([^/]+)\/ZoroCoding\.app\/Contents\/MacOS\/ZoroCoding$/,
  );
  if ((input.isPackaged && packagedMatch === null) ||
      (!input.isPackaged && input.developmentRoot === undefined)) {
    throw new Error("ZoroCoding 必须从可写的移动硬盘运行。");
  }
  const volumeRoot = input.isPackaged
    ? `/Volumes/${packagedMatch![1]}`
    : path.resolve(input.developmentRoot!);
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

function canonicalizeExistingPath(target: string): string {
  try {
    return realpathSync.native(target);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null &&
        "code" in error && error.code === "ENOENT") {
      return target;
    }
    throw error;
  }
}
