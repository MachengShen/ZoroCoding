import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

import type {
  StorageStatus,
  TaskEventEnvelope,
  ZoroApi,
} from "../../src/shared/ipc";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const preloadDirectory = path.join(
  projectRoot,
  "dist-electron",
  "preload",
);

type IpcListener = (event: unknown, payload: unknown) => void;

class FakeIpcRenderer {
  readonly listeners = new Map<string, Set<IpcListener>>();
  readonly sentChannels: string[] = [];
  readonly sent: Array<{ channel: string; args: unknown[] }> = [];

  invoke(channel: string): Promise<{ channel: string }> {
    return Promise.resolve({ channel });
  }

  on(channel: string, listener: IpcListener): void {
    const listeners = this.listeners.get(channel) ?? new Set<IpcListener>();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }

  removeListener(channel: string, listener: IpcListener): void {
    this.listeners.get(channel)?.delete(listener);
  }

  send(channel: string, ...args: unknown[]): void {
    this.sentChannels.push(channel);
    this.sent.push({ channel, args });
  }

  emit(channel: string, payload: unknown): void {
    for (const listener of this.listeners.get(channel) ?? []) {
      listener({}, payload);
    }
  }
}

function nullPrototypeClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(nullPrototypeClone);
  }
  if (value !== null && typeof value === "object") {
    return Object.assign(
      Object.create(null),
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          nullPrototypeClone(item),
        ]),
      ),
    );
  }
  return value;
}

function taskEnvelope(subscriptionId: string): TaskEventEnvelope {
  return {
    subscriptionId,
    task: {
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      prompt: "Explain",
      status: "completed",
      providerSnapshot: {
        providerId: "provider-1",
        name: "Provider",
        kind: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        modelId: "model",
        contextLength: 128_000,
      },
      routeDecision: {
        intent: "simple_code",
        lane: "light",
        executionMode: "read_only",
        confidence: "high",
        reasonCode: "code-explanation",
      },
      selectionMode: "auto",
      executionMode: "read_only",
      progress: {
        percent: 100,
        elapsedSeconds: 1,
        remainingSeconds: 0,
        estimationState: "ready",
      },
      currentStepId: null,
      activeSince: null,
      pausedSince: null,
      pauseReason: null,
      createdAt: 1,
      updatedAt: 2,
    },
    event: {
      id: "event-1",
      taskId: "task-1",
      type: "task_completed",
      at: 2,
      payload: {},
    },
  };
}

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], {
    cwd: projectRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
}, 30_000);

describe("production sandbox preload", () => {
  it("ships one self-contained Electron-only bundle that exposes the working API", async () => {
    const files = (await readdir(preloadDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    expect(files).toEqual(["index.js"]);

    await execFileAsync(
      "/bin/zsh",
      [
        path.join(projectRoot, "scripts", "create-dmg.sh"),
        "--validate-preload",
        preloadDirectory,
      ],
      {
        cwd: preloadDirectory,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const preloadPath = path.join(preloadDirectory, "index.js");
    const source = await readFile(preloadPath, "utf8");
    const [compiler, ast] = await Promise.all([
      import("typescript/unstable/sync"),
      import("typescript/unstable/ast"),
    ]);
    const compilerApi = new compiler.API({
      cwd: path.dirname(preloadPath),
    });
    const snapshot = compilerApi.updateSnapshot({
      openFiles: [preloadPath],
    });
    try {
      const project = snapshot.getDefaultProjectForFile(preloadPath);
      const sourceFile = project?.program.getSourceFile(preloadPath);
      expect(sourceFile).toBeDefined();
      expect(
        project?.program.getSyntacticDiagnostics(preloadPath) ?? [],
      ).toEqual([]);

      let hasUseStrictDirective = false;
      for (const statement of sourceFile!.statements) {
        if (
          !ast.isExpressionStatement(statement) ||
          !ast.isStringLiteral(statement.expression)
        ) {
          break;
        }
        if (statement.expression.text === "use strict") {
          hasUseStrictDirective = true;
          break;
        }
      }
      expect(hasUseStrictDirective).toBe(true);
    } finally {
      snapshot.dispose();
      compilerApi.close();
    }

    const ipcRenderer = new FakeIpcRenderer();
    let exposedName: string | undefined;
    let exposedApi: ZoroApi | undefined;
    const electron = {
      contextBridge: {
        exposeInMainWorld(name: string, api: ZoroApi): void {
          exposedName = name;
          exposedApi = api;
        },
      },
      ipcRenderer,
    };
    const module = { exports: {} };
    const loadPreload = vm.runInNewContext(
      `(function (require, module, exports) {\n${source}\n})`,
      {},
      { filename: preloadPath },
    ) as (
      require: (identifier: string) => unknown,
      module: { exports: unknown },
      exports: unknown,
    ) => void;
    loadPreload(
      (identifier) => {
        if (identifier !== "electron") {
          throw new Error(`sandbox preload requested ${identifier}`);
        }
        return electron;
      },
      module,
      module.exports,
    );

    expect(exposedName).toBe("zoro");
    expect(exposedApi).toBeDefined();
    expect(Object.isFrozen(exposedApi)).toBe(true);
    await expect(exposedApi!.app.info()).resolves.toEqual({
      channel: "zoro:app:info",
    });

    const delivered: StorageStatus[] = [];
    const unsubscribe = exposedApi!.app.subscribeStorageStatus((status) => {
      delivered.push(status);
    });
    ipcRenderer.emit("zoro:app:storage-status", {
      storageAvailable: true,
      restartRequired: false,
      generation: 4,
    } satisfies StorageStatus);
    ipcRenderer.emit("zoro:app:storage-status", {
      storageAvailable: false,
      restartRequired: true,
      generation: 4,
    } satisfies StorageStatus);
    ipcRenderer.emit("zoro:app:storage-status", {
      storageAvailable: false,
      restartRequired: true,
      generation: 3,
    } satisfies StorageStatus);
    ipcRenderer.emit("zoro:app:storage-status", {
      storageAvailable: true,
      restartRequired: false,
      generation: 5,
    } satisfies StorageStatus);
    unsubscribe();
    ipcRenderer.emit("zoro:app:storage-status", {
      storageAvailable: false,
      restartRequired: true,
      generation: 6,
    } satisfies StorageStatus);

    expect(delivered.map((status) => status.generation)).toEqual([4, 5]);

    const deliveredTasks: TaskEventEnvelope[] = [];
    exposedApi!.tasks.subscribe((event) => deliveredTasks.push(event));
    const taskSubscription = ipcRenderer.sent.find(
      ({ channel }) => channel === "zoro:tasks:subscribe",
    )!.args[0] as string;
    ipcRenderer.emit(
      "zoro:tasks:event",
      nullPrototypeClone(taskEnvelope(taskSubscription)),
    );
    ipcRenderer.emit(
      "zoro:tasks:event",
      nullPrototypeClone({
        ...taskEnvelope(taskSubscription),
        task: {
          ...taskEnvelope(taskSubscription).task,
          prompt: "x".repeat(100_001),
        },
      }),
    );
    ipcRenderer.emit(
      "zoro:tasks:event",
      {
        ...taskEnvelope(taskSubscription),
        task: Object.assign(
          Object.create({ inherited: true }),
          taskEnvelope(taskSubscription).task,
        ),
      },
    );
    expect(deliveredTasks).toEqual([taskEnvelope(taskSubscription)]);

    expect(ipcRenderer.sentChannels).toEqual([
      "zoro:app:storage-status:subscribe",
      "zoro:app:storage-status:unsubscribe",
      "zoro:tasks:subscribe",
    ]);
  });
});
