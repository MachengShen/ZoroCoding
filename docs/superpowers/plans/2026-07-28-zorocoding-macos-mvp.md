# ZoroCoding macOS MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable macOS Electron application that lets a user select a local project, submit an AI coding task, watch real step-based progress and ETA, allow the agent to edit files and run commands under a permission gate, and manage KIMI K3 plus custom OpenAI-compatible model APIs.

**Architecture:** A sandboxed React renderer communicates through a narrow, typed preload bridge with an Electron main-process Agent Runtime. The main process owns SQLite persistence, macOS Keychain-backed secrets, model streaming, task orchestration, permission checks, filesystem changes, and shell processes. Tasks are event-backed and recover to a safe paused state after interruption.

**Tech Stack:** Electron 43.2.0, React 19.2.8, TypeScript 7.0.2, Vite 8.1.5, Vitest 4.1.10, Testing Library 16.3.2, better-sqlite3 13.0.1, Zod 4.4.3, Lucide React 1.27.0, Electron Builder 26.15.3, Playwright 1.62.0.

## Global Constraints

- Product name is exactly `ZoroCoding`.
- Target platform is macOS desktop; package both `.app` and `.dmg`.
- Use the approved three-column Codex Workbench layout.
- KIMI K3 is the built-in default provider and is called through the Moonshot/Kimi API; no local model-weight download.
- Custom providers use an OpenAI-compatible Chat Completions interface and support add, test, edit, default, and delete.
- Renderer must use `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- The renderer cannot access filesystem, shell, database, network credentials, or Node APIs directly.
- API keys never appear in SQLite, logs, messages, stack traces, or exported task data.
- Project-contained reads, writes, and ordinary development commands may run automatically; destructive, outside-project, administrator, system, and global-install actions require approval.
- Waiting for approval, manual pause, and network backoff pause the ETA clock.
- One application instance executes at most one high-privilege task at a time.
- No cloud sync, team accounts, SSH workspaces, plugin marketplace, MCP manager, scheduled automation, or automatic Git publish flow in this release.
- Use `NPM_CONFIG_CACHE=/private/tmp/zorocoding-npm-cache` for npm commands because the default user npm cache path is not a directory in this environment.

---

## File Map

### Project and build

- `package.json` — scripts, exact dependencies, Electron entry, builder metadata.
- `electron-builder.yml` — `.app`/`.dmg` packaging and native module unpacking.
- `vite.config.ts` — renderer build and Vitest jsdom configuration.
- `tsconfig.json` — shared renderer/test TypeScript configuration.
- `tsconfig.main.json` — CommonJS main/preload build for Electron and native modules.
- `index.html` — renderer entry document.
- `.gitignore` — dependencies, build products, local databases, logs, design companion state.

### Shared contracts

- `src/shared/domain.ts` — task, step, event, provider, tool, and error types.
- `src/shared/ipc.ts` — validated IPC request/response schemas and `ZoroApi`.
- `src/shared/time.ts` — injectable clock contract.

### Electron main and preload

- `src/main/index.ts` — app lifecycle and dependency composition.
- `src/main/createWindow.ts` — secure BrowserWindow creation and navigation denial.
- `src/main/ipc/registerIpc.ts` — IPC handlers and task-event subscription.
- `src/preload/index.ts` — context bridge exposing only `window.zoro`.

### Task and persistence

- `src/main/tasks/taskReducer.ts` — legal task state transitions and event reduction.
- `src/main/tasks/progressEngine.ts` — weighted progress and adaptive ETA.
- `src/main/persistence/database.ts` — SQLite connection and migrations.
- `src/main/persistence/taskRepository.ts` — task snapshots, steps, messages, events, file changes.
- `src/main/persistence/providerRepository.ts` — non-secret provider configuration.

### Models and secrets

- `src/main/secrets/secretStore.ts` — macOS Keychain-backed encrypted secret values.
- `src/main/models/types.ts` — model-neutral message, tool-call, stream, and provider interfaces.
- `src/main/models/openAiCompatibleProvider.ts` — native-fetch Chat Completions streaming adapter.
- `src/main/models/modelGateway.ts` — provider lookup, secret resolution, connectivity tests.

### Tools and agent

- `src/main/tools/permissionEngine.ts` — path and command risk decisions.
- `src/main/tools/fileTools.ts` — contained reads, searches, atomic writes, conflict detection, diffs.
- `src/main/tools/shellTool.ts` — streaming `/bin/zsh` commands and process-tree cancellation.
- `src/main/tools/toolRegistry.ts` — model-facing schemas and dispatch.
- `src/main/agent/planParser.ts` — strict task-plan parsing.
- `src/main/agent/agentRuntime.ts` — model/tool loop, pause, approval, retry, cancel, recovery.

### Renderer

- `src/renderer/main.tsx` — React mount.
- `src/renderer/App.tsx` — application composition and screen routing.
- `src/renderer/styles.css` — approved design tokens, layout, responsive behavior, motion reduction.
- `src/renderer/state/useZoroStore.ts` — renderer state, commands, and event subscription.
- `src/renderer/components/Sidebar.tsx` — project and task navigation.
- `src/renderer/components/Workbench.tsx` — task header, timeline, changes, terminal activity, composer.
- `src/renderer/components/ProgressPanel.tsx` — progress, ETA, and steps.
- `src/renderer/components/NewTaskDialog.tsx` — project, model, and prompt flow.
- `src/renderer/components/ApprovalDialog.tsx` — exact high-risk operation confirmation.
- `src/renderer/components/SettingsView.tsx` — provider list and defaults.
- `src/renderer/components/ProviderDialog.tsx` — add/edit/test/delete provider form.
- `src/renderer/components/EmptyState.tsx` — first-run project/task guidance.
- `src/renderer/global.d.ts` — `window.zoro` typing.

### Tests

- `tests/setup.ts` — jsdom matchers.
- `tests/main/taskReducer.test.ts`
- `tests/main/progressEngine.test.ts`
- `tests/main/database.test.ts`
- `tests/main/modelGateway.test.ts`
- `tests/main/openAiCompatibleProvider.test.ts`
- `tests/main/permissionEngine.test.ts`
- `tests/main/fileTools.test.ts`
- `tests/main/shellTool.test.ts`
- `tests/main/agentRuntime.test.ts`
- `tests/main/ipc.test.ts`
- `tests/renderer/App.test.tsx`
- `tests/renderer/SettingsView.test.tsx`
- `tests/e2e/app.spec.ts`

---

### Task 1: Secure Electron shell and test harness

**Files:**
- Create: `package.json`
- Create: `electron-builder.yml`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.main.json`
- Create: `index.html`
- Create: `.gitignore`
- Create: `src/main/index.ts`
- Create: `src/main/createWindow.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/global.d.ts`
- Create: `src/renderer/styles.css`
- Create: `tests/setup.ts`
- Create: `tests/main/createWindow.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `createMainWindow(options: CreateWindowOptions): BrowserWindow`, build/test/package scripts, and a sandboxed preload bridge entry.

- [ ] **Step 1: Add the failing BrowserWindow security test**

```ts
// tests/main/createWindow.test.ts
import { describe, expect, it, vi } from "vitest";
import { buildWindowOptions } from "../../src/main/createWindow";

describe("buildWindowOptions", () => {
  it("isolates and sandboxes the renderer", () => {
    const options = buildWindowOptions("/tmp/preload.js");
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: "/tmp/preload.js",
    });
  });
});
```

- [ ] **Step 2: Create the package manifest and install exact dependencies**

```json
{
  "name": "zorocoding",
  "version": "0.1.0",
  "private": true,
  "description": "A local macOS coding agent with real task progress.",
  "main": "dist-electron/main/index.js",
  "scripts": {
    "dev": "concurrently -k \"vite\" \"tsc -p tsconfig.main.json --watch --preserveWatchOutput\" \"wait-on http://127.0.0.1:5173 dist-electron/main/index.js && electron .\"",
    "build:renderer": "vite build",
    "build:main": "tsc -p tsconfig.main.json",
    "build": "npm run build:main && npm run build:renderer",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "npm run build && playwright test",
    "package:mac": "npm run build && electron-builder --mac dmg",
    "postinstall": "electron-builder install-app-deps"
  }
}
```

Run:

```bash
NPM_CONFIG_CACHE=/private/tmp/zorocoding-npm-cache npm install --save-exact react@19.2.8 react-dom@19.2.8 better-sqlite3@13.0.1 zod@4.4.3 lucide-react@1.27.0
NPM_CONFIG_CACHE=/private/tmp/zorocoding-npm-cache npm install --save-dev --save-exact electron@43.2.0 electron-builder@26.15.3 vite@8.1.5 @vitejs/plugin-react@6.0.4 typescript@7.0.2 vitest@4.1.10 jsdom@30.0.0 @testing-library/react@16.3.2 @testing-library/jest-dom@7.0.0 @testing-library/user-event@14.6.1 @playwright/test@1.62.0 @types/react@19.2.17 @types/react-dom@19.2.3 @types/node@26.1.1 @types/better-sqlite3@7.6.13 concurrently@10.0.4 wait-on@9.1.0
```

Expected: `package-lock.json` is created and native Electron dependencies rebuild successfully.

- [ ] **Step 3: Run the security test to verify it fails**

Run: `npm test -- tests/main/createWindow.test.ts`

Expected: FAIL because `buildWindowOptions` does not exist.

- [ ] **Step 4: Implement the secure window factory and minimal app**

```ts
// src/main/createWindow.ts
import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from "electron";

export function buildWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  };
}

export function createMainWindow(preload: string): BrowserWindow {
  const window = new BrowserWindow(buildWindowOptions(preload));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  return window;
}
```

`src/main/index.ts` must wait for `app.whenReady()`, create the window, load `VITE_DEV_SERVER_URL` in development or `dist-renderer/index.html` in production, and quit on `window-all-closed`.

`src/preload/index.ts` exposes an empty frozen `window.zoro` object until Task 7.

- [ ] **Step 5: Run unit tests and production build**

Run:

```bash
npm test -- tests/main/createWindow.test.ts
npm run build
```

Expected: test PASS; `dist-electron` and `dist-renderer` are created without TypeScript errors.

- [ ] **Step 6: Commit the shell**

```bash
git add package.json package-lock.json electron-builder.yml vite.config.ts tsconfig.json tsconfig.main.json index.html .gitignore src tests/setup.ts tests/main/createWindow.test.ts
git commit -m "feat: scaffold secure ZoroCoding desktop shell"
```

---

### Task 2: Task state machine and adaptive progress engine

**Files:**
- Create: `src/shared/domain.ts`
- Create: `src/shared/time.ts`
- Create: `src/main/tasks/taskReducer.ts`
- Create: `src/main/tasks/progressEngine.ts`
- Create: `tests/main/taskReducer.test.ts`
- Create: `tests/main/progressEngine.test.ts`

**Interfaces:**
- Consumes: none.
- Produces:
  - `reduceTask(snapshot: TaskSnapshot, event: TaskEvent): TaskSnapshot`
  - `computeProgress(input: ProgressInput): ProgressSnapshot`
  - domain types `TaskSnapshot`, `TaskEvent`, `TaskStep`, `TaskStatus`, `ProgressSnapshot`.

- [ ] **Step 1: Write failing transition and progress tests**

```ts
// tests/main/taskReducer.test.ts
it("pauses a running task after an interruption", () => {
  const next = reduceTask(runningTask, {
    id: "e1",
    taskId: runningTask.id,
    type: "app_interrupted",
    at: 1_000,
    payload: {},
  });
  expect(next.status).toBe("paused");
  expect(next.pauseReason).toBe("interrupted");
});
```

```ts
// tests/main/progressEngine.test.ts
it("uses completed step weights and caps the active step at 85 percent", () => {
  const result = computeProgress({
    now: 10_000,
    activeSince: 5_000,
    pausedSince: null,
    steps: [
      step({ status: "completed", estimateSeconds: 20, actualSeconds: 20 }),
      step({ status: "running", estimateSeconds: 80, observedFraction: 1 }),
    ],
  });
  expect(result.percent).toBe(88);
  expect(result.remainingSeconds).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify missing modules fail**

Run: `npm test -- tests/main/taskReducer.test.ts tests/main/progressEngine.test.ts`

Expected: FAIL because the domain, reducer, and progress modules do not exist.

- [ ] **Step 3: Define exact task and event contracts**

```ts
export type TaskStatus =
  | "draft"
  | "planning"
  | "running"
  | "awaiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export interface TaskStep {
  id: string;
  taskId: string;
  order: number;
  title: string;
  completionCriteria: string;
  estimateSeconds: number;
  actualSeconds: number | null;
  observedFraction: number;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

export interface ProgressSnapshot {
  percent: number;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  estimationState: "ready" | "recalculating" | "paused";
}
```

`TaskEvent` is a discriminated union covering planning, step start/progress/complete/fail, approval requested/resolved, pause/resume, retry, completion, cancellation, provider failure, and app interruption.

- [ ] **Step 4: Implement legal transitions and ETA calculation**

The reducer must reject illegal transitions by throwing `InvalidTaskTransitionError`. `computeProgress` must:

```ts
const totalWeight = sum(steps.map((step) => step.estimateSeconds));
const completedWeight = sum(completed.map((step) => step.estimateSeconds));
const activeContribution =
  active === undefined ? 0 : active.estimateSeconds * Math.min(active.observedFraction, 0.85);
const percent = Math.round(((completedWeight + activeContribution) / totalWeight) * 100);
```

Apply an exponentially smoothed correction ratio from completed steps using `alpha = 0.35`, clamp the ratio to `0.5...3`, and return `remainingSeconds: null` when no finite estimate exists.

- [ ] **Step 5: Run domain tests**

Run: `npm test -- tests/main/taskReducer.test.ts tests/main/progressEngine.test.ts`

Expected: all transition, pause, replan, cap, smoothing, and empty-plan tests PASS.

- [ ] **Step 6: Commit the domain**

```bash
git add src/shared src/main/tasks tests/main/taskReducer.test.ts tests/main/progressEngine.test.ts
git commit -m "feat: add task state and adaptive progress engine"
```

---

### Task 3: SQLite event-backed persistence

**Files:**
- Create: `src/main/persistence/database.ts`
- Create: `src/main/persistence/taskRepository.ts`
- Create: `src/main/persistence/providerRepository.ts`
- Create: `tests/main/database.test.ts`

**Interfaces:**
- Consumes: `TaskSnapshot`, `TaskStep`, `TaskEvent`, `ProviderConfig` from `src/shared/domain.ts`.
- Produces:
  - `openDatabase(filePath: string): Database.Database`
  - `TaskRepository.create`, `appendEvent`, `replaceSteps`, `list`, `get`, `recoverInterrupted`
  - `ProviderRepository.create`, `update`, `list`, `get`, `remove`, `setDefault`.

- [ ] **Step 1: Write the failing migration and recovery test**

```ts
it("persists events and recovers running tasks as paused", () => {
  const db = openDatabase(":memory:");
  const repository = new TaskRepository(db);
  repository.create(task({ status: "running" }));
  repository.appendEvent(interruptedEvent);
  repository.recoverInterrupted(5_000);
  expect(repository.get("task-1")?.status).toBe("paused");
  expect(repository.events("task-1").at(-1)?.type).toBe("app_interrupted");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/main/database.test.ts`

Expected: FAIL because persistence modules do not exist.

- [ ] **Step 3: Implement schema migration version 1**

Create tables:

```sql
CREATE TABLE schema_version (version INTEGER NOT NULL);
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canonical_path TEXT NOT NULL UNIQUE,
  last_opened_at INTEGER NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_snapshot_json TEXT NOT NULL,
  progress_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  pause_reason TEXT
);
CREATE TABLE task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  data_json TEXT NOT NULL
);
CREATE TABLE task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE file_changes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  canonical_path TEXT NOT NULL,
  before_hash TEXT NOT NULL,
  after_hash TEXT NOT NULL,
  patch TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model_id TEXT NOT NULL,
  context_length INTEGER NOT NULL,
  headers_json TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Enable foreign keys, WAL mode for file databases, prepared statements, and transactions for snapshot plus event updates.

- [ ] **Step 4: Implement repositories and JSON validation**

Every JSON column read must pass through the matching Zod schema from `src/shared/domain.ts`. `recoverInterrupted` finds `planning`, `running`, and `awaiting_approval` tasks and appends an `app_interrupted` event before setting them to `paused`.

- [ ] **Step 5: Run database tests**

Run: `npm test -- tests/main/database.test.ts`

Expected: migration, CRUD, event ordering, transaction rollback, JSON validation, and interruption recovery tests PASS.

- [ ] **Step 6: Commit persistence**

```bash
git add src/main/persistence tests/main/database.test.ts
git commit -m "feat: persist tasks and providers in SQLite"
```

---

### Task 4: Keychain-backed secrets and model gateway

**Files:**
- Create: `src/main/secrets/secretStore.ts`
- Create: `src/main/models/types.ts`
- Create: `src/main/models/openAiCompatibleProvider.ts`
- Create: `src/main/models/modelGateway.ts`
- Create: `tests/main/modelGateway.test.ts`
- Create: `tests/main/openAiCompatibleProvider.test.ts`

**Interfaces:**
- Consumes: provider rows from `ProviderRepository`.
- Produces:
  - `SecretStore.put(ref: string, value: string): Promise<void>`
  - `SecretStore.get(ref: string): Promise<string | null>`
  - `SecretStore.remove(ref: string): Promise<void>`
  - `ModelProvider.stream(request: ModelRequest): AsyncIterable<ModelEvent>`
  - `ModelGateway.testProvider`, `stream`, `createProvider`, `deleteProvider`.

- [ ] **Step 1: Write failing SSE and secret-redaction tests**

```ts
it("combines streamed tool-call arguments by index", async () => {
  const events = await collect(provider.stream(request));
  expect(events).toContainEqual({
    type: "tool_call",
    call: { id: "call-1", name: "read_file", arguments: "{\"path\":\"src/App.tsx\"}" },
  });
});

it("never includes the API key in a normalized error", async () => {
  await expect(gateway.testProvider(providerId)).rejects.not.toThrow("secret-value");
});
```

- [ ] **Step 2: Run model tests to verify they fail**

Run: `npm test -- tests/main/modelGateway.test.ts tests/main/openAiCompatibleProvider.test.ts`

Expected: FAIL because model and secret modules do not exist.

- [ ] **Step 3: Implement the secret store**

`SecretStore` receives an Electron-compatible crypto adapter:

```ts
export interface SecretCrypto {
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class SecretStore {
  constructor(
    private readonly directory: string,
    private readonly crypto: SecretCrypto,
  ) {}
}
```

Each secret is written atomically to `<directory>/<sha256(ref)>.secret` with mode `0o600`. The encrypted bytes are produced by `safeStorage`; filenames and database rows never contain the key value.

- [ ] **Step 4: Implement OpenAI-compatible streaming**

POST `${baseUrlWithoutTrailingSlash}/chat/completions` with:

```ts
{
  model: config.modelId,
  messages: request.messages,
  tools: request.tools,
  tool_choice: "auto",
  stream: true,
  stream_options: { include_usage: true }
}
```

Parse `data:` SSE frames, stop at `[DONE]`, merge `delta.tool_calls[index].function.arguments`, emit text deltas immediately, and emit complete tool calls only after `finish_reason === "tool_calls"`.

Normalize errors to:

```ts
export interface ModelFailure {
  code: "auth" | "not_found" | "rate_limited" | "network" | "server" | "invalid_response";
  message: string;
  retryable: boolean;
  retryAfterMs: number | null;
}
```

- [ ] **Step 5: Implement gateway CRUD and KIMI template**

The built-in template is:

```ts
{
  name: "KIMI K3",
  kind: "kimi",
  baseUrl: "https://api.moonshot.cn/v1",
  modelId: "kimi-k3",
  contextLength: 1_000_000,
  headers: {},
}
```

`testProvider` sends a non-streaming request with `max_tokens: 1`. `deleteProvider` rejects deletion when the provider is referenced by a running task, then removes the encrypted secret before deleting metadata.

- [ ] **Step 6: Run model tests**

Run: `npm test -- tests/main/modelGateway.test.ts tests/main/openAiCompatibleProvider.test.ts`

Expected: SSE text, fragmented tool calls, auth, 429 retry hints, network errors, secret redaction, CRUD, and default-provider tests PASS.

- [ ] **Step 7: Commit model integration**

```bash
git add src/main/secrets src/main/models tests/main/modelGateway.test.ts tests/main/openAiCompatibleProvider.test.ts
git commit -m "feat: add KIMI and compatible model gateway"
```

---

### Task 5: Permission gate, file tools, and shell execution

**Files:**
- Create: `src/main/tools/permissionEngine.ts`
- Create: `src/main/tools/fileTools.ts`
- Create: `src/main/tools/shellTool.ts`
- Create: `src/main/tools/toolRegistry.ts`
- Create: `tests/main/permissionEngine.test.ts`
- Create: `tests/main/fileTools.test.ts`
- Create: `tests/main/shellTool.test.ts`

**Interfaces:**
- Consumes: `ToolCall`, `ToolResult`, and permission types from shared domain.
- Produces:
  - `PermissionEngine.assess(operation, projectRoot): PermissionDecision`
  - `FileTools.read`, `search`, `writeAtomic`, `diff`
  - `ShellTool.run`, `ShellTool.cancel`
  - `ToolRegistry.definitions`, `ToolRegistry.execute`.

- [ ] **Step 1: Write failing containment and command-risk tests**

```ts
it("requires approval when a symlink resolves outside the project", async () => {
  const decision = await engine.assess(
    { kind: "read_file", path: join(project, "escape", "secret.txt") },
    project,
  );
  expect(decision.level).toBe("ask");
});

it.each(["rm -rf build", "sudo make install", "npm install -g tool", "brew install jq"])(
  "requires approval for %s",
  async (command) => {
    expect((await engine.assess({ kind: "shell", command }, project)).level).toBe("ask");
  },
);
```

- [ ] **Step 2: Write failing atomic-write conflict test**

```ts
it("refuses to overwrite a file changed after it was read", async () => {
  const read = await files.read("src/a.ts");
  await writeFile(join(project, "src/a.ts"), "external change");
  await expect(files.writeAtomic("src/a.ts", "agent change", read.sha256))
    .rejects.toMatchObject({ code: "file_conflict" });
});
```

- [ ] **Step 3: Run tool tests to verify they fail**

Run: `npm test -- tests/main/permissionEngine.test.ts tests/main/fileTools.test.ts tests/main/shellTool.test.ts`

Expected: FAIL because tool modules do not exist.

- [ ] **Step 4: Implement canonical path and command checks**

Canonicalize with `realpath` for existing paths and the nearest existing parent for new files. Allow only paths equal to the project root or prefixed by `${projectRoot}${sep}`. Mark delete operations, outside paths, `sudo`, system directories, shell redirection outside the root, `rm`, disk tools, shutdown commands, global package flags, and system installers as `ask`.

Return:

```ts
export interface PermissionDecision {
  level: "allow" | "ask" | "deny";
  summary: string;
  reasons: string[];
}
```

- [ ] **Step 5: Implement atomic file writes and diffs**

Read returns content, mtime, and SHA-256. Write compares the expected hash, writes a sibling temporary file with the existing mode, renames it over the target, and returns a unified patch plus before/after hashes. Searches ignore `.git`, `node_modules`, and build output and cap results at 500.

- [ ] **Step 6: Implement cancellable shell execution**

Spawn:

```ts
spawn("/bin/zsh", ["-lc", command], {
  cwd: canonicalProjectRoot,
  detached: true,
  env: sanitizedEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
});
```

Stream timestamped stdout/stderr chunks. On cancel, send `SIGTERM` to the negative process-group PID, wait 1.5 seconds, then send `SIGKILL` if still alive. Return exit code, signal, duration, and the final 200 KB of output.

- [ ] **Step 7: Run tool tests**

Run: `npm test -- tests/main/permissionEngine.test.ts tests/main/fileTools.test.ts tests/main/shellTool.test.ts`

Expected: containment, symlink, risk, conflict, atomicity, stream, nonzero exit, and cancellation tests PASS.

- [ ] **Step 8: Commit tools**

```bash
git add src/main/tools tests/main/permissionEngine.test.ts tests/main/fileTools.test.ts tests/main/shellTool.test.ts
git commit -m "feat: add permissioned file and shell tools"
```

---

### Task 6: Agent planning and model/tool loop

**Files:**
- Create: `src/main/agent/planParser.ts`
- Create: `src/main/agent/agentRuntime.ts`
- Create: `tests/main/agentRuntime.test.ts`

**Interfaces:**
- Consumes: `TaskRepository`, `ModelGateway`, `ToolRegistry`, `PermissionEngine`, task reducer, progress engine.
- Produces:
  - `AgentRuntime.createTask(input): Promise<TaskSnapshot>`
  - `AgentRuntime.pause`, `resume`, `cancel`, `resolveApproval`
  - `AgentRuntime.subscribe(listener): () => void`.

- [ ] **Step 1: Write the failing happy-path runtime test**

```ts
it("plans, executes a tool, updates progress, and completes", async () => {
  const runtime = harness({
    modelEvents: [
      planningText([{ title: "Inspect", completionCriteria: "file read", estimateSeconds: 30 }]),
      toolCall("read_file", { path: "src/App.tsx" }),
      text("The file is valid."),
      finish(),
    ],
  });
  const task = await runtime.createTask(input);
  await runtime.waitForIdle();
  expect(runtime.repository.get(task.id)?.status).toBe("completed");
  expect(runtime.repository.steps(task.id)[0].status).toBe("completed");
  expect(runtime.events(task.id).map((event) => event.type)).toContain("tool_completed");
});
```

- [ ] **Step 2: Write the failing approval and retry test**

```ts
it("pauses ETA while waiting for destructive-command approval", async () => {
  const runtime = harness({ modelEvents: [planningText(plan), toolCall("shell", { command: "rm -rf build" })] });
  const task = await runtime.createTask(input);
  await runtime.waitForStatus("awaiting_approval");
  expect(runtime.progress(task.id).estimationState).toBe("paused");
  await runtime.resolveApproval(task.id, "deny");
  expect(runtime.events(task.id).at(-1)?.type).toBe("approval_resolved");
});
```

- [ ] **Step 3: Run runtime tests to verify they fail**

Run: `npm test -- tests/main/agentRuntime.test.ts`

Expected: FAIL because the agent runtime does not exist.

- [ ] **Step 4: Implement strict plan parsing**

The planning prompt requires JSON only:

```json
{
  "title": "Short task title",
  "steps": [
    {
      "title": "Actionable step",
      "completionCriteria": "Observable completion condition",
      "estimateSeconds": 120
    }
  ]
}
```

Accept 1–12 steps, titles from 1–120 characters, criteria from 1–240 characters, and estimates from 5–7,200 seconds. One repair request is allowed after invalid JSON; a second failure moves the task to `failed`.

- [ ] **Step 5: Implement the agent loop**

The runtime must:

1. Serialize execution through one task queue.
2. Save the user message and enter `planning`.
3. Request and persist a plan.
4. Enter `running`, call the selected model with tool definitions, and stream text events.
5. Assess each tool call before execution.
6. Emit `approval_requested` and await `resolveApproval` when decision is `ask`.
7. Persist tool input summary and complete output before sending a tool message back to the model.
8. Retry retryable model failures up to three times using `1s`, `2s`, `4s`, pausing ETA during backoff.
9. Complete when the model finishes without more tool calls and every non-skipped plan step is complete.
10. Abort fetch and shell processes on pause or cancel.

- [ ] **Step 6: Implement safe recovery**

At startup call `TaskRepository.recoverInterrupted(now)`. `resume` begins a fresh model request from persisted messages and tool results; it never re-executes a completed tool event.

- [ ] **Step 7: Run runtime tests**

Run: `npm test -- tests/main/agentRuntime.test.ts`

Expected: happy path, invalid plan repair, approval allow/deny, pause, cancel, retry, no duplicate tool execution, and recovery tests PASS.

- [ ] **Step 8: Commit agent runtime**

```bash
git add src/main/agent tests/main/agentRuntime.test.ts
git commit -m "feat: orchestrate model planning and tool execution"
```

---

### Task 7: Typed IPC and preload bridge

**Files:**
- Create: `src/shared/ipc.ts`
- Create: `src/main/ipc/registerIpc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`
- Create: `tests/main/ipc.test.ts`

**Interfaces:**
- Consumes: repositories, `AgentRuntime`, `ModelGateway`, Electron dialog.
- Produces: `window.zoro` implementing `ZoroApi`.

- [ ] **Step 1: Write a failing malformed-request test**

```ts
it("rejects a create-task request without a project path", async () => {
  registerIpc(dependencies);
  await expect(invoke("zoro:tasks:create", { prompt: "Fix it" }))
    .rejects.toThrow("Invalid create task request");
});
```

- [ ] **Step 2: Run IPC tests to verify they fail**

Run: `npm test -- tests/main/ipc.test.ts`

Expected: FAIL because IPC contracts and registration do not exist.

- [ ] **Step 3: Define the exact preload API**

```ts
export interface ZoroApi {
  projects: {
    select(): Promise<ProjectSummary | null>;
    list(): Promise<ProjectSummary[]>;
  };
  tasks: {
    list(projectId?: string): Promise<TaskSummary[]>;
    get(taskId: string): Promise<TaskDetail>;
    create(input: CreateTaskInput): Promise<TaskDetail>;
    pause(taskId: string): Promise<void>;
    resume(taskId: string): Promise<void>;
    cancel(taskId: string): Promise<void>;
    resolveApproval(taskId: string, decision: "allow_once" | "deny"): Promise<void>;
    subscribe(listener: (event: TaskEventEnvelope) => void): () => void;
  };
  providers: {
    list(): Promise<ProviderSummary[]>;
    create(input: ProviderInput): Promise<ProviderSummary>;
    update(id: string, input: ProviderInput): Promise<ProviderSummary>;
    test(input: ProviderTestInput): Promise<ConnectionResult>;
    setDefault(id: string): Promise<void>;
    remove(id: string): Promise<void>;
  };
}
```

- [ ] **Step 4: Implement validated handlers and subscription cleanup**

Validate every invoke argument with Zod before touching dependencies. The subscription channel sends only serializable event envelopes and removes the main-process listener when the renderer sends `zoro:tasks:unsubscribe` or is destroyed.

The project picker uses `dialog.showOpenDialog({ properties: ["openDirectory"] })`, canonicalizes the result, and never accepts a path supplied by renderer state as a new authorization.

- [ ] **Step 5: Expose the frozen bridge**

```ts
contextBridge.exposeInMainWorld("zoro", Object.freeze({
  projects: Object.freeze(projectApi),
  tasks: Object.freeze(taskApi),
  providers: Object.freeze(providerApi),
}));
```

- [ ] **Step 6: Run IPC tests and build**

Run:

```bash
npm test -- tests/main/ipc.test.ts
npm run build
```

Expected: schema validation, project authorization, handler routing, subscription cleanup, and TypeScript build PASS.

- [ ] **Step 7: Commit IPC**

```bash
git add src/shared/ipc.ts src/main/ipc src/main/index.ts src/preload/index.ts src/renderer/global.d.ts tests/main/ipc.test.ts
git commit -m "feat: expose typed ZoroCoding desktop API"
```

---

### Task 8: Approved Codex Workbench renderer

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Create: `src/renderer/state/useZoroStore.ts`
- Create: `src/renderer/components/Sidebar.tsx`
- Create: `src/renderer/components/Workbench.tsx`
- Create: `src/renderer/components/ProgressPanel.tsx`
- Create: `src/renderer/components/NewTaskDialog.tsx`
- Create: `src/renderer/components/ApprovalDialog.tsx`
- Create: `src/renderer/components/EmptyState.tsx`
- Create: `tests/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `window.zoro`, `TaskSummary`, `TaskDetail`, `TaskEventEnvelope`.
- Produces: complete task creation and monitoring experience.

- [ ] **Step 1: Generate and inspect the production visual reference**

Use the approved visual direction:

- dark charcoal left task rail;
- white central workbench;
- pale neutral right progress rail;
- fluorescent lime as the only primary accent;
- compact macOS desktop density;
- no marketing hero, badge clutter, gradients, decorative illustrations, or card wall.

Save the accepted concept under `docs/design/zorocoding-workbench-concept.png`. Record exact colors, type scale, spacing, controls, icons, and responsive rules in `docs/design/zorocoding-design-tokens.md`.

- [ ] **Step 2: Write the failing renderer workflow test**

```tsx
it("creates a task and renders live progress", async () => {
  render(<App />);
  await user.click(screen.getByRole("button", { name: "发起新任务" }));
  await user.click(screen.getByRole("button", { name: "选择项目" }));
  await user.type(screen.getByLabelText("任务要求"), "修复登录状态恢复");
  await user.click(screen.getByRole("button", { name: "开始任务" }));
  expect(await screen.findByText("修复登录状态恢复")).toBeVisible();
  expect(screen.getByText("预计剩余")).toBeVisible();
});
```

- [ ] **Step 3: Run renderer test to verify it fails**

Run: `npm test -- tests/renderer/App.test.tsx`

Expected: FAIL because the workbench components and state store do not exist.

- [ ] **Step 4: Implement the renderer store**

`useZoroStore` loads projects, tasks, providers, and active task on mount; subscribes exactly once; reduces task events into visible state; and exposes `createTask`, `selectTask`, `pause`, `resume`, `cancel`, and `resolveApproval`. All rejected commands populate a visible, dismissible error region.

- [ ] **Step 5: Implement the three-column shell**

Use semantic landmarks:

```tsx
<div className="app-shell">
  <Sidebar />
  <main className="workbench"><Workbench /></main>
  <aside aria-label="任务进度"><ProgressPanel /></aside>
</div>
```

The sidebar contains ZoroCoding mark, new task, current project, grouped task history, and settings. The workbench contains task/model header, timeline events, expandable diff and terminal output, composer, and pause control. The progress panel contains status, ETA, elapsed time, weighted bar, step list, and recent command output.

- [ ] **Step 6: Implement task and approval dialogs**

The new-task dialog requires authorized project, provider, and non-empty prompt. The approval dialog displays exact command or path, reasons, project boundary, and only “允许一次” and “拒绝” actions. Escape defaults to refusal and never approves.

- [ ] **Step 7: Implement responsive and accessibility rules**

At widths below 1,080 px, hide the progress rail behind a labeled drawer button. At widths below 900 px, collapse task titles but preserve the new-task button. Add visible focus rings, `aria-live="polite"` for task status, status text in addition to color, and a `prefers-reduced-motion` branch.

- [ ] **Step 8: Run renderer tests and inspect the built UI**

Run:

```bash
npm test -- tests/renderer/App.test.tsx
npm run build
```

Expected: create/select/pause/approval/error/accessibility tests PASS; production build succeeds.

Capture the running renderer at the accepted concept dimensions and compare with the concept for layout, copy, typography, palette, spacing, container model, and responsive behavior. Fix every material mismatch before committing.

- [ ] **Step 9: Commit the workbench**

```bash
git add docs/design src/renderer tests/renderer/App.test.tsx
git commit -m "feat: build the ZoroCoding task workbench"
```

---

### Task 9: Provider settings, deletion safety, and recovery UX

**Files:**
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/components/SettingsView.tsx`
- Create: `src/renderer/components/ProviderDialog.tsx`
- Modify: `src/renderer/state/useZoroStore.ts`
- Modify: `src/renderer/styles.css`
- Create: `tests/renderer/SettingsView.test.tsx`

**Interfaces:**
- Consumes: `window.zoro.providers`.
- Produces: provider CRUD, test status, default selection, and safe interrupted-task presentation.

- [ ] **Step 1: Write failing provider CRUD tests**

```tsx
it("adds, tests, defaults, and deletes a compatible provider", async () => {
  render(<SettingsView />);
  await user.click(screen.getByRole("button", { name: "添加模型 API" }));
  await user.type(screen.getByLabelText("名称"), "团队模型");
  await user.type(screen.getByLabelText("Base URL"), "https://api.example.com/v1");
  await user.type(screen.getByLabelText("模型 ID"), "team-code");
  await user.type(screen.getByLabelText("API Key"), "secret");
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  expect(await screen.findByText("连接成功")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByText("团队模型")).toBeVisible();
});
```

- [ ] **Step 2: Run settings tests to verify they fail**

Run: `npm test -- tests/renderer/SettingsView.test.tsx`

Expected: FAIL because settings components do not exist.

- [ ] **Step 3: Implement provider list and form validation**

Fields:

- name: 1–60 characters;
- Base URL: HTTPS URL, except `http://localhost` and `http://127.0.0.1`;
- API Key: required on create, optional on edit;
- model ID: 1–120 characters;
- context length: integer from 1,024 to 2,000,000;
- custom headers: key/value rows, with `Authorization`, `Cookie`, and `Host` rejected.

The list displays provider name, model ID, masked key suffix, connection result, and default state.

- [ ] **Step 4: Implement connection and deletion states**

Disable save while a connection test is active. Show separate text for auth failure, missing model, rate limit, network, and server failure. Deletion opens a confirmation naming the provider and is disabled with an explanation when a running task uses it.

- [ ] **Step 5: Implement interrupted-task UX**

When a task has `pauseReason === "interrupted"`, show “上次执行被中断” and a primary “安全继续” action. Never auto-resume at application startup.

- [ ] **Step 6: Run settings and renderer tests**

Run:

```bash
npm test -- tests/renderer/SettingsView.test.tsx tests/renderer/App.test.tsx
npm run build
```

Expected: provider validation, connectivity states, default switch, deletion safety, secret masking, and interrupted-task tests PASS.

- [ ] **Step 7: Commit settings**

```bash
git add src/renderer tests/renderer/SettingsView.test.tsx
git commit -m "feat: manage model APIs and task recovery"
```

---

### Task 10: End-to-end verification, packaging, and operator documentation

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/app.spec.ts`
- Create: `tests/e2e/fixtures/mockModelServer.ts`
- Create: `README.md`
- Modify: `electron-builder.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: complete application.
- Produces: deterministic E2E suite, installable `.dmg`, and setup/run documentation.

- [ ] **Step 1: Create a deterministic mock model server**

The server supports:

- valid planning JSON;
- streamed text;
- fragmented tool calls;
- one forced 429 followed by success;
- auth failure;
- delayed response cancellable by the app.

It binds only to `127.0.0.1` on an ephemeral port and records received messages without API keys.

- [ ] **Step 2: Write the failing Electron E2E path**

```ts
test("creates a project task, edits a file, runs a command, and restores history", async () => {
  const app = await electron.launch({ args: [resolve("dist-electron/main/index.js")] });
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "发起新任务" }).click();
  await authorizeFixtureProject(page, fixtureProject);
  await page.getByLabel("任务要求").fill("更新版本并运行测试");
  await page.getByRole("button", { name: "开始任务" }).click();
  await expect(page.getByText("100%")).toBeVisible();
  await expect(page.getByText("任务已完成")).toBeVisible();
  expect(await readFile(join(fixtureProject, "version.txt"), "utf8")).toBe("2\n");
  await app.close();
});
```

- [ ] **Step 3: Run E2E to verify the main path fails**

Run: `npm run test:e2e`

Expected: FAIL until test-mode project authorization, mock provider injection, and packaging paths are wired.

- [ ] **Step 4: Add explicit test-mode dependency injection**

Only when `ZORO_E2E === "1"`, read:

- `ZORO_E2E_PROJECT_PATH`
- `ZORO_E2E_PROVIDER_BASE_URL`
- `ZORO_E2E_USER_DATA`

Production builds ignore these variables unless the E2E flag is present. The E2E suite uses a temporary user-data directory and deletes it after the test.

- [ ] **Step 5: Complete README**

Document:

- macOS requirement;
- `npm install`, `npm run dev`, `npm test`, `npm run test:e2e`, `npm run package:mac`;
- KIMI K3 API-key setup through the UI;
- custom provider fields;
- safe-mode approval rules;
- where task data and encrypted secrets are stored;
- how pause, cancel, retry, and interrupted recovery behave;
- signing/notarization is required before public distribution.

- [ ] **Step 6: Run the full verification suite**

Run:

```bash
npm test
npm run build
npm run test:e2e
npm run package:mac
```

Expected:

- all unit and integration tests PASS;
- Electron E2E main path PASS;
- production build contains no TypeScript errors;
- `release/ZoroCoding-0.1.0-arm64.dmg` exists;
- packaged app launches and opens the first-run empty state.

- [ ] **Step 7: Perform final visual and security QA**

Verify desktop width 1360×860 and a compact width below 1080 px. Compare the latest screenshot with `docs/design/zorocoding-workbench-concept.png` using at least:

1. exact visible copy;
2. three-column proportions;
3. dark/white/pale-neutral palette and lime accent;
4. control typography and icon weight;
5. spacing and container model;
6. progress rail and ETA prominence;
7. responsive drawer behavior.

Confirm:

- no API key in database, logs, DOM text, error output, or screenshots;
- outside-project symlink access asks for approval;
- destructive shell command asks for approval;
- closing the renderer pauses a running task;
- provider deletion removes its encrypted secret;
- task restart does not duplicate completed tool calls.

- [ ] **Step 8: Commit the release candidate**

```bash
git add package.json electron-builder.yml playwright.config.ts tests/e2e README.md
git commit -m "test: verify and package ZoroCoding macOS MVP"
```
