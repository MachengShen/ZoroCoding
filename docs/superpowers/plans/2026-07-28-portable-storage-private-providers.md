# Portable Storage and Private Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock ZoroCoding data and projects to the external drive, preload safe provider templates, and configure the user's private providers with Kimi K3 selected as the default without embedding any API key in source or release artifacts.

**Architecture:** Resolve a fail-closed portable layout before Electron service initialization, set `userData` to the external `AppData`, and enforce a canonical `Projects` boundary at project selection and task launch. Keep provider templates non-secret, discover current model IDs through authenticated main-process requests, store connection metadata in SQLite, and import actual keys only through the installed app so `safeStorage` encrypts them for the current macOS user.

**Tech Stack:** Electron 43, React 19, TypeScript 7, Vite 8, better-sqlite3 13, Zod 4, Vitest 4, Playwright 1.62, macOS `safeStorage`, ad-hoc `codesign`, DMG packaging.

## Global Constraints

- The packaged app must run from `/Volumes/<volume>/ZoroCoding.app`; launching a packaged copy outside `/Volumes` fails closed.
- Application data must be `/Volumes/<volume>/ZoroCodingData/AppData`.
- Authorized projects must be `/Volumes/<volume>/ZoroCodingData/Projects` or canonical descendants.
- No fallback path on the Mac internal disk is permitted.
- Symlinks, path traversal, and nested mount points must not escape the canonical Projects root.
- API keys must never appear in source, plans, Git history, logs, SQLite plaintext, test snapshots, DMG resources, or terminal output.
- API keys must be encrypted with Electron `safeStorage`; SQLite stores only a random secret reference and a four-character suffix.
- Kimi K3 must remain the default provider even if its latest connection test fails.
- Other providers must never become automatic failover targets; switching providers is a user action.
- Existing task, progress, file, shell, recovery, and permission behavior must remain compatible.
- Existing internal-disk ZoroCoding data must not be deleted during migration.

---

## File Structure

- `src/main/portable/portableLayout.ts`: pure external-volume layout resolution and containment rules.
- `src/main/portable/preparePortableStorage.ts`: directory creation, permissions, writability checks, and legacy data copy.
- `src/main/portable/storageMonitor.ts`: external-storage availability polling and transition notifications.
- `src/main/projects/projectBoundary.ts`: canonical project authorization under the Projects root.
- `src/main/models/providerTemplates.ts`: non-secret provider presets and billing/dashboard metadata.
- `src/main/models/modelDiscovery.ts`: authenticated OpenAI-compatible model listing and safe model ranking.
- `src/main/index.ts`: early portable bootstrap, service wiring, storage monitor, and app information.
- `src/main/ipc/registerIpc.ts`: project boundary enforcement, app info, templates, model discovery, and provider health IPC.
- `src/main/persistence/database.ts`: schema version 2 migration.
- `src/main/persistence/providerRepository.ts`: provider health and template metadata persistence.
- `src/main/models/modelGateway.ts`: draft model discovery and persisted provider connection tests.
- `src/main/agent/agentRuntime.ts`: non-persisting emergency interruption when external storage disappears.
- `src/shared/domain.ts`: provider health metadata.
- `src/shared/ipc.ts`: app info, provider template, and model discovery contracts.
- `src/preload/index.ts`: typed app and provider bridges.
- `src/renderer/state/useZoroStore.ts`: portable status state.
- `src/renderer/components/SettingsView.tsx`: portable location, template cards, and provider health.
- `src/renderer/components/ProviderDialog.tsx`: template selection and model refresh.
- `src/renderer/App.tsx`: storage-unavailable blocking notice.
- `src/renderer/styles.css`: status and template styling.
- `tests/main/portableLayout.test.ts`: packaged path resolution and containment.
- `tests/main/preparePortableStorage.test.ts`: directory setup and non-destructive migration.
- `tests/main/storageMonitor.test.ts`: availability transitions.
- `tests/main/projectBoundary.test.ts`: canonical project boundary and symlink escape.
- `tests/main/database.test.ts`: schema 1-to-2 migration and provider health persistence.
- `tests/main/modelDiscovery.test.ts`: safe model listing and ranking.
- `tests/main/modelGateway.test.ts`: encrypted configuration and connection metadata.
- `tests/main/ipc.test.ts`: new IPC and task-time boundary revalidation.
- `tests/main/agentRuntime.test.ts`: storage-loss interruption.
- `tests/renderer/SettingsView.test.tsx`: template, health, and portable path UI.
- `tests/renderer/App.test.tsx`: blocking external-storage notice.
- `tests/e2e/app.spec.ts`: temporary portable-root workflow.
- `README.md`: external-drive layout, portability, key security, and recovery.
- `package.json`, `package-lock.json`, `electron-builder.yml`, `scripts/create-dmg.sh`: versioned release packaging.

### Task 1: Resolve and Prepare a Fail-Closed Portable Layout

**Files:**
- Create: `src/main/portable/portableLayout.ts`
- Create: `src/main/portable/preparePortableStorage.ts`
- Create: `tests/main/portableLayout.test.ts`
- Create: `tests/main/preparePortableStorage.test.ts`

**Interfaces:**
- Produces:
  - `resolvePortableLayout(input: PortableLayoutInput): PortableLayout`
  - `isCanonicalDescendant(root: string, candidate: string): boolean`
  - `preparePortableStorage(layout: PortableLayout, legacyUserData?: string): Promise<void>`
- `PortableLayout` contains `volumeRoot`, `dataRoot`, `appDataRoot`, `projectsRoot`, `logsRoot`, and `backupsRoot`.

- [ ] **Step 1: Write failing layout tests**

```ts
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

it("uses an explicit portable root only in non-packaged tests", () => {
  expect(resolvePortableLayout({
    isPackaged: false,
    execPath: "/tmp/zorocoding",
    developmentRoot: "/tmp/zoro-portable",
  }).projectsRoot).toBe("/tmp/zoro-portable/ZoroCodingData/Projects");
});
```

- [ ] **Step 2: Run layout tests and verify RED**

Run: `npm test -- tests/main/portableLayout.test.ts`

Expected: FAIL because `portableLayout.ts` does not exist.

- [ ] **Step 3: Implement minimal pure layout resolution**

```ts
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

export function resolvePortableLayout(input: PortableLayoutInput): PortableLayout {
  const volumeRoot = input.isPackaged
    ? path.resolve(path.dirname(input.execPath), "../../..")
    : path.resolve(input.developmentRoot ?? "");
  if ((input.isPackaged && !volumeRoot.startsWith("/Volumes/")) ||
      (!input.isPackaged && input.developmentRoot === undefined)) {
    throw new Error("ZoroCoding 必须从可写的移动硬盘运行。");
  }
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
```

- [ ] **Step 4: Run layout tests and verify GREEN**

Run: `npm test -- tests/main/portableLayout.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing storage preparation tests**

```ts
it("creates the complete portable layout with private permissions", async () => {
  const layout = layoutUnder(await temporaryDirectory());
  await preparePortableStorage(layout);
  for (const directory of [
    layout.dataRoot,
    layout.appDataRoot,
    layout.projectsRoot,
    layout.logsRoot,
    layout.backupsRoot,
  ]) {
    expect((await stat(directory)).isDirectory()).toBe(true);
  }
});

it("copies legacy data only when the portable destination is empty", async () => {
  const legacy = await temporaryDirectory();
  const layout = layoutUnder(await temporaryDirectory());
  await writeFile(path.join(legacy, "zorocoding.sqlite"), "legacy");
  await preparePortableStorage(layout, legacy);
  expect(await readFile(path.join(layout.appDataRoot, "zorocoding.sqlite"), "utf8"))
    .toBe("legacy");
  await writeFile(path.join(layout.appDataRoot, "zorocoding.sqlite"), "portable");
  await preparePortableStorage(layout, legacy);
  expect(await readFile(path.join(layout.appDataRoot, "zorocoding.sqlite"), "utf8"))
    .toBe("portable");
});

it("rejects a data root whose real path escapes the selected volume", async () => {
  const volume = await temporaryDirectory();
  const outside = await temporaryDirectory();
  await symlink(outside, path.join(volume, "ZoroCodingData"));
  await expect(preparePortableStorage(layoutUnder(volume))).rejects.toThrow("真实路径");
});
```

- [ ] **Step 6: Run preparation tests and verify RED**

Run: `npm test -- tests/main/preparePortableStorage.test.ts`

Expected: FAIL because `preparePortableStorage` is missing.

- [ ] **Step 7: Implement secure creation, write probe, and non-destructive migration**

Implementation requirements:

```ts
await mkdir(layout.appDataRoot, { recursive: true, mode: 0o700 });
await mkdir(layout.projectsRoot, { recursive: true, mode: 0o700 });
await mkdir(layout.logsRoot, { recursive: true, mode: 0o700 });
await mkdir(layout.backupsRoot, { recursive: true, mode: 0o700 });
await chmod(layout.dataRoot, 0o700);
await chmod(layout.appDataRoot, 0o700);

const realVolume = await realpath(layout.volumeRoot);
const realData = await realpath(layout.dataRoot);
if (!isCanonicalDescendant(realVolume, realData)) {
  throw new Error("ZoroCodingData 的真实路径离开了移动硬盘。");
}

const probe = path.join(layout.appDataRoot, `.write-probe-${randomUUID()}`);
await writeFile(probe, "ok", { mode: 0o600, flag: "wx" });
await unlink(probe);
```

Copy only existing `zorocoding.sqlite`, `zorocoding.sqlite-wal`, `zorocoding.sqlite-shm`, and the `secrets` directory when the corresponding portable target does not exist. Never remove the legacy source.

- [ ] **Step 8: Run preparation tests and verify GREEN**

Run: `npm test -- tests/main/preparePortableStorage.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add src/main/portable tests/main/portableLayout.test.ts tests/main/preparePortableStorage.test.ts
git commit -m "feat: add fail-closed portable storage layout"
```

### Task 2: Bootstrap Electron on Portable AppData

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/runtimeMode.ts`
- Modify: `tests/main/runtimeMode.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/registerIpc.ts`
- Modify: `tests/main/ipc.test.ts`

**Interfaces:**
- Consumes `resolvePortableLayout` and `preparePortableStorage` from Task 1.
- Produces `AppInfo { portable: true; volumeName: string; dataRoot: string; projectsRoot: string; storageAvailable: boolean }`.
- Produces `window.zoro.app.info(): Promise<AppInfo>`.

- [ ] **Step 1: Write failing bootstrap-mode and app-info tests**

```ts
it("does not let packaged builds use a development portable override", () => {
  expect(resolveDevelopmentPortableRoot(true, "/tmp/override")).toBeUndefined();
  expect(resolveDevelopmentPortableRoot(false, "/tmp/override")).toBe("/tmp/override");
});

it("returns only non-secret portable application information", async () => {
  registerIpc({
    ...dependencies,
    appInfo: {
      portable: true,
      volumeName: "ORICO",
      dataRoot: "/Volumes/ORICO/ZoroCodingData",
      projectsRoot: "/Volumes/ORICO/ZoroCodingData/Projects",
      storageAvailable: true,
    },
  });
  expect(await ipcMain.invoke("zoro:app:info")).toEqual(
    expect.objectContaining({ volumeName: "ORICO", storageAvailable: true }),
  );
});
```

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `npm test -- tests/main/runtimeMode.test.ts tests/main/ipc.test.ts`

Expected: FAIL because the development-root resolver and `zoro:app:info` do not exist.

- [ ] **Step 3: Implement early portable bootstrap**

Before `app.whenReady()`:

```ts
const legacyUserData = app.getPath("userData");
const portableLayout = resolvePortableLayout({
  isPackaged: app.isPackaged,
  execPath: process.execPath,
  developmentRoot: resolveDevelopmentPortableRoot(
    app.isPackaged,
    process.env.ZORO_E2E_PORTABLE_ROOT,
  ),
});
app.setPath("userData", portableLayout.appDataRoot);
```

Inside the ready handler, call `preparePortableStorage(portableLayout, legacyUserData)` before opening SQLite. If preparation fails, show a blocking `dialog.showErrorBox` containing the external path and exit with `app.quit()`. Do not call `initializeServices`.

- [ ] **Step 4: Add typed app-info IPC and preload bridge**

Add:

```ts
export interface AppInfo {
  portable: true;
  volumeName: string;
  dataRoot: string;
  projectsRoot: string;
  storageAvailable: boolean;
}
```

Expose:

```ts
const appApi: ZoroApi["app"] = {
  info: () => ipcRenderer.invoke("zoro:app:info"),
};
```

Register `zoro:app:info` as a read-only channel and pass the prepared layout into `registerIpc`.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run: `npm test -- tests/main/runtimeMode.test.ts tests/main/ipc.test.ts`

Expected: PASS.

- [ ] **Step 6: Run the main-process build**

Run: `npm run build:main`

Expected: exit code 0.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/main/index.ts src/main/runtimeMode.ts src/shared/ipc.ts src/preload/index.ts src/main/ipc/registerIpc.ts tests/main/runtimeMode.test.ts tests/main/ipc.test.ts
git commit -m "feat: bootstrap Electron from portable app data"
```

### Task 3: Enforce the Canonical Projects Boundary

**Files:**
- Create: `src/main/projects/projectBoundary.ts`
- Create: `tests/main/projectBoundary.test.ts`
- Modify: `src/main/ipc/registerIpc.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/main/ipc.test.ts`
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**
- Produces `authorizeProjectPath(projectsRoot: string, selectedPath: string): Promise<string>`.
- `DialogLike.showOpenDialog` accepts `{ properties: ["openDirectory"]; defaultPath: string }`.
- `registerIpc` consumes `projectsRoot`.

- [ ] **Step 1: Write failing canonical-boundary tests**

```ts
it("accepts the Projects root and real descendants", async () => {
  expect(await authorizeProjectPath(root, path.join(root, "demo")))
    .toBe(await realpath(path.join(root, "demo")));
});

it("rejects a sibling directory", async () => {
  await expect(authorizeProjectPath(root, sibling)).rejects.toThrow("Projects");
});

it("rejects a symlink inside Projects that resolves outside", async () => {
  await symlink(outside, path.join(root, "escape"));
  await expect(authorizeProjectPath(root, path.join(root, "escape")))
    .rejects.toThrow("Projects");
});
```

- [ ] **Step 2: Run boundary tests and verify RED**

Run: `npm test -- tests/main/projectBoundary.test.ts`

Expected: FAIL because `authorizeProjectPath` does not exist.

- [ ] **Step 3: Implement canonical authorization**

```ts
export async function authorizeProjectPath(
  projectsRoot: string,
  selectedPath: string,
): Promise<string> {
  const [root, candidate] = await Promise.all([
    realpath(projectsRoot),
    realpath(selectedPath),
  ]);
  if (!isCanonicalDescendant(root, candidate)) {
    throw new Error("项目必须位于 ZoroCodingData/Projects 内。");
  }
  return candidate;
}
```

- [ ] **Step 4: Run boundary tests and verify GREEN**

Run: `npm test -- tests/main/projectBoundary.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing IPC enforcement tests**

Cover both selection and task creation:

```ts
expect(dialog.showOpenDialog).toHaveBeenCalledWith({
  properties: ["openDirectory"],
  defaultPath: projectsRoot,
});

await expect(ipcMain.invoke("zoro:tasks:create", {
  projectId: "outside-project",
  providerId: "provider-1",
  prompt: "修改代码",
})).rejects.toThrow("Projects");
expect(dependencies.runtime.createTask).not.toHaveBeenCalled();
```

- [ ] **Step 6: Run IPC tests and verify RED**

Run: `npm test -- tests/main/ipc.test.ts`

Expected: FAIL because the picker has no `defaultPath` and task creation does not revalidate the stored path.

- [ ] **Step 7: Wire the boundary into selection and task creation**

Use `authorizeProjectPath` after the picker returns and again immediately before `runtime.createTask`. The second check prevents stale database paths and post-selection symlink changes from bypassing the root.

- [ ] **Step 8: Update E2E portable roots**

Create a temporary portable root, create `ZoroCodingData/Projects/fixture`, and launch with:

```ts
ZORO_E2E_PORTABLE_ROOT: portableRoot,
ZORO_E2E_PROJECT_PATH: fixtureProject,
```

Assert the selected path is visible and the full task workflow still modifies only `fixtureProject`.

- [ ] **Step 9: Run boundary and IPC tests**

Run: `npm test -- tests/main/projectBoundary.test.ts tests/main/ipc.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

Run:

```bash
git add src/main/projects src/main/ipc/registerIpc.ts src/main/index.ts tests/main/projectBoundary.test.ts tests/main/ipc.test.ts tests/e2e/app.spec.ts
git commit -m "feat: lock projects to the portable workspace"
```

### Task 4: Stop Active Work When External Storage Disappears

**Files:**
- Create: `src/main/portable/storageMonitor.ts`
- Create: `tests/main/storageMonitor.test.ts`
- Modify: `src/main/agent/agentRuntime.ts`
- Modify: `tests/main/agentRuntime.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/registerIpc.ts`

**Interfaces:**
- Produces `startStorageMonitor(options: StorageMonitorOptions): () => void`.
- Produces `AgentRuntime.interruptForStorageLoss(): Promise<void>`.
- App info reads the current availability flag through a getter, not a captured boolean.

- [ ] **Step 1: Write failing monitor tests**

```ts
it("notifies only when storage transitions from available to unavailable", async () => {
  const checks = [true, true, false, false, true];
  const unavailable = vi.fn();
  const restored = vi.fn();
  const monitor = createStorageMonitor({
    check: async () => checks.shift() ?? true,
    onUnavailable: unavailable,
    onRestored: restored,
  });
  await monitor.checkNow();
  await monitor.checkNow();
  await monitor.checkNow();
  await monitor.checkNow();
  await monitor.checkNow();
  expect(unavailable).toHaveBeenCalledOnce();
  expect(restored).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run monitor tests and verify RED**

Run: `npm test -- tests/main/storageMonitor.test.ts`

Expected: FAIL because the monitor does not exist.

- [ ] **Step 3: Implement an injected, non-overlapping monitor**

The monitor checks both `appDataRoot` and `projectsRoot` with `access(path, constants.R_OK | constants.W_OK)`, prevents concurrent checks, emits only on state changes, and returns `stop()` that clears its timer. Use a 3-second production interval and injected manual checks in tests.

- [ ] **Step 4: Run monitor tests and verify GREEN**

Run: `npm test -- tests/main/storageMonitor.test.ts`

Expected: PASS.

- [ ] **Step 5: Write a failing emergency-interruption test**

```ts
it("aborts model calls and tools on storage loss without writing another event", async () => {
  const { runtime, repository, tools } = activeRuntimeHarness();
  const before = repository.events("task-1").length;
  await runtime.interruptForStorageLoss();
  expect(tools.cancelAll).toHaveBeenCalled();
  expect(repository.events("task-1")).toHaveLength(before);
});
```

- [ ] **Step 6: Run runtime test and verify RED**

Run: `npm test -- tests/main/agentRuntime.test.ts`

Expected: FAIL because `interruptForStorageLoss` does not exist.

- [ ] **Step 7: Implement non-persisting interruption**

```ts
async interruptForStorageLoss(): Promise<void> {
  for (const controller of this.abortControllers.values()) {
    controller.abort();
  }
  await Promise.all(
    [...this.activeTools.values()].map((tools) => tools.cancelAll().catch(() => {})),
  );
  for (const approval of this.pendingApprovals.values()) {
    approval.resolve(false);
  }
  this.pendingApprovals.clear();
}
```

This path deliberately does not touch SQLite after storage loss. On next launch, the existing recovery logic converts persisted `running` tasks to `paused`.

- [ ] **Step 8: Wire storage transitions into main**

On unavailable:

1. Set `storageAvailable = false`.
2. Call `runtime?.interruptForStorageLoss()`.
3. Notify all windows through `zoro:app:storage-status`.
4. Block state-changing IPC with “移动硬盘已断开”.

On restored, set the flag true and require an app restart before resuming tasks so SQLite and encrypted files are reopened cleanly.

- [ ] **Step 9: Run targeted tests**

Run: `npm test -- tests/main/storageMonitor.test.ts tests/main/agentRuntime.test.ts tests/main/ipc.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

Run:

```bash
git add src/main/portable/storageMonitor.ts src/main/agent/agentRuntime.ts src/main/index.ts src/main/ipc/registerIpc.ts tests/main/storageMonitor.test.ts tests/main/agentRuntime.test.ts tests/main/ipc.test.ts
git commit -m "feat: stop active work when portable storage disappears"
```

### Task 5: Add Non-Secret Provider Templates, Model Discovery, and Health

**Files:**
- Create: `src/main/models/providerTemplates.ts`
- Create: `src/main/models/modelDiscovery.ts`
- Create: `tests/main/modelDiscovery.test.ts`
- Modify: `src/shared/domain.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/persistence/database.ts`
- Modify: `src/main/persistence/providerRepository.ts`
- Modify: `src/main/models/modelGateway.ts`
- Modify: `src/main/ipc/registerIpc.ts`
- Modify: `src/preload/index.ts`
- Modify: `tests/main/database.test.ts`
- Modify: `tests/main/modelGateway.test.ts`
- Modify: `tests/main/ipc.test.ts`

**Interfaces:**
- Produces `PROVIDER_TEMPLATES: readonly ProviderTemplate[]`.
- Produces `discoverModels(input: ModelDiscoveryInput): Promise<ModelOption[]>`.
- Produces `ModelGateway.discoverDraftModels(input)` and `ModelGateway.testAndRecordProvider(id)`.
- Provider metadata gains `connectionStatus`, `connectionMessage`, `lastTestedAt`, `billingNote`, and `dashboardUrl`.

- [ ] **Step 1: Write failing template and discovery tests**

```ts
it("contains every requested provider without credentials", () => {
  expect(PROVIDER_TEMPLATES.map((item) => item.id)).toEqual([
    "kimi-k3",
    "groq",
    "gemini",
    "openrouter",
    "cerebras",
    "sambanova",
    "mistral",
    "nvidia",
    "zhipu",
    "ollama",
  ]);
  expect(JSON.stringify(PROVIDER_TEMPLATES)).not.toMatch(
    /(apiKey|gsk_|sk-or-|csk-|nvapi-)/i,
  );
});

it("lists models using bearer authentication but never returns the key", async () => {
  const requests: Request[] = [];
  const models = await discoverModels({
    baseUrl: "https://api.example.com/v1",
    apiKey: "private-test-key",
    fetchImpl: async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ data: [{ id: "code-large" }, { id: "chat-small" }] });
    },
  });
  expect(models).toEqual([
    { id: "code-large", label: "code-large" },
    { id: "chat-small", label: "chat-small" },
  ]);
  expect(requests[0].headers.get("authorization")).toBe("Bearer private-test-key");
  expect(JSON.stringify(models)).not.toContain("private-test-key");
});

it("rejects non-HTTPS remote model-list URLs", async () => {
  await expect(discoverModels({
    baseUrl: "http://api.example.com/v1",
    apiKey: "private-test-key",
    fetchImpl: fetch,
  })).rejects.toThrow("HTTPS");
});
```

- [ ] **Step 2: Run discovery tests and verify RED**

Run: `npm test -- tests/main/modelDiscovery.test.ts`

Expected: FAIL because the catalog and discovery module do not exist.

- [ ] **Step 3: Implement the non-secret catalog**

Catalog entries:

```ts
{ id: "kimi-k3", name: "KIMI K3", kind: "kimi",
  baseUrl: "https://api.moonshot.cn/v1", suggestedModelId: "kimi-k3",
  contextLength: 1_000_000, billingNote: "付费模型", dashboardUrl: "https://platform.kimi.com/" }
{ id: "groq", name: "Groq", kind: "openai-compatible",
  baseUrl: "https://api.groq.com/openai/v1", suggestedModelId: "qwen/qwen3.6-27b",
  contextLength: 131_072, billingNote: "免费额度", dashboardUrl: "https://console.groq.com/keys" }
{ id: "gemini", name: "Google Gemini", kind: "openai-compatible",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  suggestedModelId: "gemini-3.5-flash", contextLength: 1_000_000,
  billingNote: "免费层受地区限制", dashboardUrl: "https://aistudio.google.com/apikey" }
{ id: "openrouter", name: "OpenRouter", kind: "openai-compatible",
  baseUrl: "https://openrouter.ai/api/v1", suggestedModelId: "openrouter/free",
  contextLength: 200_000, billingNote: "免费模型限额", dashboardUrl: "https://openrouter.ai/settings/keys" }
```

For Cerebras, SambaNova, NVIDIA, and Zhipu, keep `suggestedModelId` unset and require authenticated discovery before save. Mistral uses the stable alias `mistral-small-latest`. Ollama uses `http://127.0.0.1:11434/v1` and an ignored local key entered as `ollama`.

- [ ] **Step 4: Implement safe model discovery**

Use the already existing provider security validator, normalize the Base URL, GET `${baseUrl}/models`, require a successful response, parse only `data[].id`, cap the list at 500 entries, reject IDs outside 1–200 characters, sort preferred coding terms (`code`, `coder`, `qwen`, `glm`, `gpt-oss`) before generic chat models, and never include response headers or request authorization in returned errors.

- [ ] **Step 5: Run discovery tests and verify GREEN**

Run: `npm test -- tests/main/modelDiscovery.test.ts`

Expected: PASS.

- [ ] **Step 6: Write failing schema migration tests**

Create a real schema-version-1 database, open it with the new code, and assert:

```ts
expect(db.prepare("SELECT version FROM schema_version").pluck().get()).toBe(2);
expect(repository.get("provider-1")).toMatchObject({
  connectionStatus: "untested",
  connectionMessage: null,
  lastTestedAt: null,
});
```

Also assert a successful test persists `connected` and a failed test persists `error` without storing the API key or raw provider response.

- [ ] **Step 7: Run database tests and verify RED**

Run: `npm test -- tests/main/database.test.ts`

Expected: FAIL because schema version 1 is rejected and the health columns do not exist.

- [ ] **Step 8: Implement incremental schema version 2**

Migration from version 1:

```sql
ALTER TABLE providers ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'untested';
ALTER TABLE providers ADD COLUMN connection_message TEXT;
ALTER TABLE providers ADD COLUMN last_tested_at INTEGER;
ALTER TABLE providers ADD COLUMN billing_note TEXT NOT NULL DEFAULT '计费规则由服务商决定';
ALTER TABLE providers ADD COLUMN dashboard_url TEXT NOT NULL DEFAULT '';
UPDATE schema_version SET version = 2;
```

Hydrate and persist the new fields in `ProviderRepository`. Validate status as `untested | connected | error`.

- [ ] **Step 9: Implement gateway discovery and persisted health**

`testAndRecordProvider(id)` resolves the encrypted key, performs the existing minimal chat request, then updates health:

```ts
try {
  const result = await provider.testConnection(signal);
  this.providers.updateHealth(id, {
    connectionStatus: "connected",
    connectionMessage: "连接正常",
    lastTestedAt: this.now(),
  });
  return result;
} catch (error) {
  this.providers.updateHealth(id, {
    connectionStatus: "error",
    connectionMessage: safeConnectionMessage(error),
    lastTestedAt: this.now(),
  });
  throw error;
}
```

Inject `now` into `ModelGateway` for deterministic tests. Kimi remains default because connection testing never changes `is_default`.

- [ ] **Step 10: Add IPC and preload methods**

Expose:

```ts
templates(): Promise<ProviderTemplate[]>;
discoverModels(input: ProviderModelDiscoveryInput): Promise<ModelOption[]>;
testSaved(id: string): Promise<ConnectionResult>;
```

Validate all inputs with strict Zod schemas. `templates` returns immutable non-secret catalog data.

- [ ] **Step 11: Run provider tests**

Run: `npm test -- tests/main/modelDiscovery.test.ts tests/main/database.test.ts tests/main/modelGateway.test.ts tests/main/ipc.test.ts`

Expected: PASS.

- [ ] **Step 12: Commit Task 5**

Run:

```bash
git add src/main/models src/main/persistence src/shared src/main/ipc/registerIpc.ts src/preload/index.ts tests/main/modelDiscovery.test.ts tests/main/database.test.ts tests/main/modelGateway.test.ts tests/main/ipc.test.ts
git commit -m "feat: add safe provider templates and model discovery"
```

### Task 6: Build the Portable and Provider Settings Experience

**Files:**
- Modify: `src/renderer/state/useZoroStore.ts`
- Modify: `src/renderer/components/SettingsView.tsx`
- Modify: `src/renderer/components/ProviderDialog.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `tests/renderer/SettingsView.test.tsx`
- Modify: `tests/renderer/App.test.tsx`

**Interfaces:**
- Consumes `window.zoro.app.info`, `window.zoro.providers.templates`, `discoverModels`, and `testSaved`.
- `ProviderDialog` accepts `template?: ProviderTemplate`.

- [ ] **Step 1: Write failing Settings tests**

```tsx
it("shows the locked portable locations", async () => {
  installApi({ appInfo: {
    portable: true,
    volumeName: "ORICO",
    dataRoot: "/Volumes/ORICO/ZoroCodingData",
    projectsRoot: "/Volumes/ORICO/ZoroCodingData/Projects",
    storageAvailable: true,
  }});
  render(<SettingsView />);
  expect(await screen.findByText("ORICO/ZoroCodingData")).toBeVisible();
  expect(screen.getByText("项目只能存放在 Projects")).toBeVisible();
});

it("prefills the Kimi template without exposing a key", async () => {
  render(<SettingsView />);
  await user.click(await screen.findByRole("button", { name: "配置 KIMI K3" }));
  expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.moonshot.cn/v1");
  expect(screen.getByLabelText("模型 ID")).toHaveValue("kimi-k3");
  expect(screen.getByLabelText("API Key")).toHaveValue("");
});

it("discovers models after a key is entered and lets the user select one", async () => {
  await user.type(screen.getByLabelText("API Key"), "private-test-key");
  await user.click(screen.getByRole("button", { name: "获取可用模型" }));
  expect(providers.discoverModels).toHaveBeenCalledWith(
    expect.objectContaining({ apiKey: "private-test-key" }),
  );
  expect(await screen.findByRole("option", { name: "code-large" })).toBeVisible();
});

it("shows connection health without rendering secret material", async () => {
  render(<SettingsView />);
  expect(await screen.findByText("连接正常")).toBeVisible();
  expect(screen.getByText("••••1234")).toBeVisible();
  expect(document.body.textContent).not.toContain("private-test-key");
});
```

- [ ] **Step 2: Run Settings tests and verify RED**

Run: `npm test -- tests/renderer/SettingsView.test.tsx`

Expected: FAIL because the portable card, templates, discovery, and health UI do not exist.

- [ ] **Step 3: Implement template and health UI**

Add a “移动硬盘存储” section with volume name, data location, project location, and a green available status. Add “快速配置” buttons for Kimi, Groq, Gemini, OpenRouter, Cerebras, SambaNova, Mistral, NVIDIA, Zhipu, and Ollama.

Provider rows show:

- `默认` only for the persisted default.
- `连接正常`, `尚未测试`, or the sanitized error.
- Last tested time when present.
- Billing note and a safe external dashboard link.
- Masked suffix only.

The dialog never persists the in-memory API key to React storage, browser storage, query strings, or console output.

- [ ] **Step 4: Implement model refresh**

For templates with no suggested model, disable Save until the user enters a key and successfully chooses a returned model. For templates with a suggestion, allow Save after normal validation; “获取可用模型” can replace the suggestion.

- [ ] **Step 5: Write and run the storage-unavailable App test**

```tsx
it("blocks new work when the external drive becomes unavailable", async () => {
  render(<App />);
  emitStorageStatus(false);
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("移动硬盘已断开");
  expect(screen.getByRole("button", { name: "发起新任务" })).toBeDisabled();
});
```

Run: `npm test -- tests/renderer/App.test.tsx`

Expected before implementation: FAIL.

- [ ] **Step 6: Implement the blocking notice**

Subscribe through the preload bridge. When unavailable, close the new-task dialog, disable new tasks and provider mutation, show “请重新连接移动硬盘并重新启动 ZoroCoding”, and do not offer an internal-disk fallback button.

- [ ] **Step 7: Run renderer tests**

Run: `npm test -- tests/renderer/SettingsView.test.tsx tests/renderer/App.test.tsx`

Expected: PASS.

- [ ] **Step 8: Run renderer build**

Run: `npm run build:renderer`

Expected: exit code 0.

- [ ] **Step 9: Commit Task 6**

Run:

```bash
git add src/renderer tests/renderer
git commit -m "feat: add portable storage and provider setup UI"
```

### Task 7: Verify the Full Portable Workflow and Release Package

**Files:**
- Modify: `tests/e2e/app.spec.ts`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `electron-builder.yml`
- Modify: `scripts/create-dmg.sh`

**Interfaces:**
- Produces version `0.2.0` app and `ZoroCoding-0.2.0-arm64.dmg`.

- [ ] **Step 1: Extend E2E assertions**

The E2E test must verify:

1. App info reports the temporary external root.
2. The picker authorizes only the temporary `Projects` directory.
3. A task plans, edits a file, runs a command, and reaches 100%.
4. Restart restores task history from the temporary `AppData`.
5. No file is created under the default macOS Application Support location.
6. Provider summaries never contain `secretRef` or plaintext keys.

- [ ] **Step 2: Run the complete unit and component suite**

Run: `npm test`

Expected: all tests PASS with no unhandled errors or secret output.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Run E2E**

Run: `npm run test:e2e`

Expected: PASS when Electron can launch. If the enclosing Codex sandbox blocks Electron with `SIGABRT` or `EPERM`, record the environment failure and run the existing service-level full workflow test:

Run: `npm test -- tests/main/fullWorkflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Update user documentation**

Document:

- `/Volumes/ORICO/ZoroCodingData/AppData`
- `/Volumes/ORICO/ZoroCodingData/Projects`
- No internal-disk fallback
- What happens on disconnection
- Why keys may need re-entry on another Mac
- How to update, test, set default, and delete providers
- Kimi K3 is selected as default and may incur API charges
- Private keys are not included in the distributable application

- [ ] **Step 6: Bump and package version 0.2.0**

Set `package.json` and lockfile version to `0.2.0`. Make `scripts/create-dmg.sh` derive the version and architecture from `package.json` rather than hard-coding `0.1.0`.

Run: `npm run package:mac`

Expected:

- `release/mac-arm64/ZoroCoding.app`
- `release/ZoroCoding-0.2.0-arm64.dmg`
- `release/ZoroCoding-0.2.0-arm64.dmg.sha256`

- [ ] **Step 7: Verify signature, architecture, and archive content**

Run:

```bash
codesign --verify --deep --strict release/mac-arm64/ZoroCoding.app
file release/mac-arm64/ZoroCoding.app/Contents/MacOS/ZoroCoding
npx asar list release/mac-arm64/ZoroCoding.app/Contents/Resources/app.asar
```

Expected: signature verification succeeds, executable is `arm64`, and the archive includes only expected application resources.

- [ ] **Step 8: Scan tracked files and artifacts for credential-shaped text**

Run:

```bash
git grep -nE '(gsk_|sk-or-v1-|csk-|nvapi-|api[_-]?key[[:space:]]*[:=][[:space:]]*["'\''][^"'\'']{12,})' -- ':!docs/superpowers/plans/*'
npx asar extract release/mac-arm64/ZoroCoding.app/Contents/Resources/app.asar /tmp/zorocoding-asar-audit
rg -n '(gsk_|sk-or-v1-|csk-|nvapi-)' /tmp/zorocoding-asar-audit
```

Expected: no real credential matches. Test-only strings such as `secret-value` and `e2e-key` are allowed only under `tests/` and are not in the packaged archive.

- [ ] **Step 9: Commit Task 7**

Run:

```bash
git add tests/e2e/app.spec.ts README.md package.json package-lock.json electron-builder.yml scripts/create-dmg.sh
git commit -m "build: package portable ZoroCoding 0.2.0"
```

### Task 8: Install on ORICO and Enroll Private Providers

**Files:**
- No source file contains provider keys.
- User-facing deliverables copied to the existing `outputs` directory:
  - `outputs/ZoroCoding-0.2.0-arm64.dmg`
  - `outputs/ZoroCoding-0.2.0-arm64.dmg.sha256`
  - updated `outputs/ZoroCoding-README.md`

**Interfaces:**
- Uses the installed Settings UI for secret enrollment.
- Uses each provider's connection test and model discovery endpoints.

- [ ] **Step 1: Request action-time installation confirmation**

Immediately before replacing `/Volumes/ORICO/ZoroCoding.app`, explain that this is a newly rebuilt, locally ad-hoc-signed application and ask for confirmation to overwrite the existing installed copy.

- [ ] **Step 2: Preserve the current installed version**

Use Finder to rename the existing app to `ZoroCoding 0.1.0 Backup.app`. Do not delete it until the new app launches and passes acceptance checks.

- [ ] **Step 3: Install the new app through Finder**

Copy `release/mac-arm64/ZoroCoding.app` to `/Volumes/ORICO/ZoroCoding.app`. Verify the installed bundle's `app.asar` SHA-256 matches the release bundle and run:

```bash
codesign --verify --deep --strict /Volumes/ORICO/ZoroCoding.app
```

Expected: verification succeeds.

- [ ] **Step 4: Launch and verify portable directories**

Launch the installed app. Verify the UI shows `ORICO/ZoroCodingData`, then verify:

```text
/Volumes/ORICO/ZoroCodingData/AppData
/Volumes/ORICO/ZoroCodingData/Projects
```

Do not proceed with keys if the app shows an internal path.

- [ ] **Step 5: Enroll Kimi K3 first**

Open Settings → Configure KIMI K3. Enter the Kimi key supplied in the current user conversation directly into the password field, test the connection with the minimal request, save, and ensure the card shows `默认`.

Do not copy the key into a shell command, source file, plan, clipboard history document, screenshot, or terminal output.

- [ ] **Step 6: Enroll the remaining private providers**

For Groq, Gemini, OpenRouter, Cerebras, SambaNova, Mistral, NVIDIA, and Zhipu:

1. Select the matching template.
2. Enter the corresponding key supplied in the current conversation.
3. Fetch current models when required.
4. Prefer free-tier, coding-capable, tool-capable models.
5. Run the minimal connection test.
6. Save successful configurations.
7. Save a failed configuration only when the UI can display a sanitized actionable reason.
8. Do not change the default away from Kimi K3.

- [ ] **Step 7: Verify encrypted-at-rest storage**

Close the app before inspection. Confirm SQLite provider rows contain only suffixes and secret references. Confirm files under `AppData/secrets` do not contain plaintext recognizable key prefixes. Do not print encrypted file contents.

- [ ] **Step 8: Run a real acceptance task inside Projects**

Create `/Volumes/ORICO/ZoroCodingData/Projects/ZoroCodingAcceptance`, add a harmless text file, and use Kimi K3 to request a one-line edit plus a read-only verification command. Confirm:

- Progress and countdown appear.
- Only the acceptance project changes.
- The task completes or reports a sanitized provider error.
- No internal-disk ZoroCoding output appears.

- [ ] **Step 9: Copy release deliverables**

Copy the verified DMG, checksum, and README into the workspace `outputs` directory. Verify SHA-256 again after copying.

- [ ] **Step 10: Final verification**

Run:

```bash
npm test
npm run build
git status --short
```

Expected: tests and build pass; Git is clean; no secret is tracked.

- [ ] **Step 11: Commit any documentation-only installation notes**

If installation revealed a non-secret documentation correction:

```bash
git add README.md
git commit -m "docs: clarify portable installation"
```

Do not commit AppData, provider metadata, encrypted secret files, screenshots containing suffixes, or any mounted-drive content.
