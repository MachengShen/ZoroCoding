import { constants } from "node:fs";
import { access } from "node:fs/promises";

export interface StorageMonitorOptions {
  appDataRoot: string;
  projectsRoot: string;
  onUnavailable: () => void | Promise<void>;
  onRestored: () => void | Promise<void>;
  onError?: (error: unknown) => void;
  check?: () => Promise<boolean>;
  schedule?: (callback: () => Promise<void>, delayMs: number) => unknown;
  clearSchedule?: (handle: unknown) => void;
}

const STORAGE_CHECK_INTERVAL_MS = 3_000;

async function checkStorageRoots(
  appDataRoot: string,
  projectsRoot: string,
): Promise<boolean> {
  try {
    await Promise.all([
      access(appDataRoot, constants.R_OK | constants.W_OK),
      access(projectsRoot, constants.R_OK | constants.W_OK),
    ]);
    return true;
  } catch {
    return false;
  }
}

export function startStorageMonitor(options: StorageMonitorOptions): () => void {
  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // A reporter is observational and must never destabilize monitoring.
    }
  };
  const check =
    options.check ??
    (() => checkStorageRoots(options.appDataRoot, options.projectsRoot));
  const schedule =
    options.schedule ??
    ((callback, delayMs) => setInterval(() => void callback().catch(reportError), delayMs));
  const clearSchedule = options.clearSchedule ?? ((handle) => clearInterval(handle as NodeJS.Timeout));
  let available = true;
  let checking = false;
  let stopped = false;
  let generation = 0;

  const checkNow = async (): Promise<void> => {
    if (checking) {
      return;
    }
    const checkGeneration = generation;
    checking = true;
    try {
      const nextAvailable = await check();
      if (stopped || checkGeneration !== generation) {
        return;
      }
      if (nextAvailable === available) {
        return;
      }
      try {
        if (nextAvailable) {
          await options.onRestored();
        } else {
          await options.onUnavailable();
        }
        if (!stopped && checkGeneration === generation) {
          available = nextAvailable;
        }
      } catch (error) {
        reportError(error);
      }
    } catch (error) {
      reportError(error);
    } finally {
      checking = false;
    }
  };

  const timer = schedule(checkNow, STORAGE_CHECK_INTERVAL_MS);

  return () => {
    stopped = true;
    generation += 1;
    clearSchedule(timer);
  };
}
