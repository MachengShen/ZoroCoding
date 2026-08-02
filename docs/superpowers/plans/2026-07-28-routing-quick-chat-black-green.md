# Automatic Routing, Quick Chat, and Black-Green UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local automatic model routing, enforce read-only simple project tasks, add a tool-free no-project Quick Chat, and apply the approved strict black-green UI across ZoroCoding without changing its external-drive security model.

**Architecture:** Put task classification in a shared pure TypeScript module and recompute every final decision in the Electron main process. Persist immutable route/provider snapshots in SQLite, constrain project tools by an authoritative execution mode, and run Quick Chat through an independent service that receives no project or shell dependencies. Keep every app-controlled color behind two CSS tokens and enforce the visual contract with static and Electron end-to-end tests.

**Tech Stack:** Electron 43, React 19, TypeScript 7, Zod 4, better-sqlite3 13, Vitest 4, Testing Library, Playwright 1.62, electron-builder.

## Global Constraints

- Automatic classification is local and pure: no HTTP call, API key, database, filesystem, or model is used to classify a prompt.
- Light route defaults to the configured Groq provider; premium route defaults to the configured KIMI K3 provider.
- A task or Quick Chat response keeps the provider selected at start. Never silently retry through a different provider.
- Model choice never overrides safety mode. A simple project task stays `read_only` even when KIMI K3 is selected manually; a complex task stays `agentic` even when a light provider is selected manually.
- `read_only` project tasks may only search and read inside the already-authorized project. They cannot write files or run shell commands.
- Quick Chat has no project ID, project path, FileTools, ShellTool, ToolRegistry, or tool definitions.
- Drawing/video prompts use KIMI K3 to create local SVG/Canvas/FFmpeg/Remotion/Manim scripts only after conversion to a project task.
- Provider roles store provider IDs only. API keys remain exclusively in the existing macOS `safeStorage` encrypted secret files.
- All histories and settings stay under `/Volumes/ORICO/ZoroCodingData/AppData`; projects stay under `/Volumes/ORICO/ZoroCodingData/Projects`.
- All app-controlled colors are `#000000` and `#C9FF62`. macOS traffic-light buttons and system dialogs are the only OS-controlled visual exceptions.
- Preserve all 9 configured providers, exactly one existing default provider, the KIMI K3 default, `/Volumes/ORICO/ZoroCoding 0.1.0 Backup.app`, and the existing ORICO data directory.
- Keep package version `0.2.0`, release architecture `arm64`, context isolation, sandboxing, strict preload validation, approval handling, storage-loss fail-closed behavior, and all current release gates.
- Every implementation task follows red-green-refactor: add the focused failing test, verify the intended failure, implement the smallest complete behavior, run the focused test, then commit.

---

## File Map

### Shared contracts

- Create `src/shared/taskRouting.ts`: pure prompt classifier and route types.
- Create `tests/shared/taskRouting.test.ts`: classifier precedence and ambiguity tests.
- Modify `src/shared/domain.ts`: route, execution-mode, and Quick Chat domain schemas.
- Modify `src/shared/ipc.ts`: strict task selection, routing, and Quick Chat IPC contracts.

### Main process

- Modify `src/main/persistence/database.ts`: schema v3 migration.
- Modify `src/main/persistence/taskRepository.ts`: persist task route snapshots.
- Create `src/main/persistence/modelRoutingRepository.ts`: singleton light/premium provider roles.
- Create `src/main/persistence/quickChatRepository.ts`: Quick Chat sessions and messages.
- Create `src/main/routing/modelRouter.ts`: authoritative provider resolution.
- Modify `src/main/tools/fileTools.ts`: bounded project file listing for read-only tasks.
- Modify `src/main/tools/toolRegistry.ts`: authoritative read-only tool filtering and denial.
- Modify `src/main/agent/agentRuntime.ts`: capture route metadata and construct tools by execution mode.
- Create `src/main/quick-chat/quickChatService.ts`: tool-free model streaming, persistence, cancel, retry.
- Modify `src/main/ipc/registerIpc.ts`: validated routing and Quick Chat endpoints.
- Modify `src/main/index.ts`: dependency wiring and storage-loss interruption.
- Modify `src/main/createWindow.ts`: black first frame.
- Modify `src/preload/index.ts`: frozen routing and Quick Chat API surface.

### Renderer

- Modify `src/renderer/state/useZoroStore.ts`: routing config, Quick Chat, and task-view state.
- Modify `src/renderer/App.tsx`: switch between project workbench, Quick Chat, and settings.
- Modify `src/renderer/components/Sidebar.tsx`: add Quick Chat entry and sessions.
- Modify `src/renderer/components/NewTaskDialog.tsx`: automatic selection preview and manual override.
- Modify `src/renderer/components/SettingsView.tsx`: light/premium role controls.
- Create `src/renderer/components/QuickChatView.tsx`: no-project conversation UI.
- Create `src/renderer/components/CodePatch.tsx`: semantic patch lines.
- Create `src/renderer/components/TerminalOutput.tsx`: semantic stdout/stderr blocks.
- Modify `src/renderer/components/Workbench.tsx`: route summary and semantic outputs.
- Modify `src/renderer/components/ProgressPanel.tsx`: shared terminal rendering.
- Modify `src/renderer/styles.css`: strict two-color theme.

### Tests and handoff

- Modify `tests/main/database.test.ts`.
- Create `tests/main/modelRoutingRepository.test.ts`.
- Create `tests/main/modelRouter.test.ts`.
- Modify `tests/main/toolRegistry.test.ts`.
- Modify `tests/main/agentRuntime.test.ts`.
- Create `tests/main/quickChatRepository.test.ts`.
- Create `tests/main/quickChatService.test.ts`.
- Modify `tests/main/ipc.test.ts`.
- Modify `tests/main/preload.test.ts`.
- Modify `tests/main/createWindow.test.ts`.
- Create `tests/renderer/RoutingSettings.test.tsx`.
- Create `tests/renderer/QuickChatView.test.tsx`.
- Create `tests/renderer/OutputBlocks.test.tsx`.
- Create `tests/renderer/themeContract.test.ts`.
- Modify `tests/renderer/App.test.tsx`.
- Modify `tests/e2e/app.spec.ts`.
- Update `outputs/ZoroCoding-安装与验收说明.md`.

---

### Task 1: Create the Pure Local Task Classifier

**Files:**
- Create: `src/shared/taskRouting.ts`
- Create: `tests/shared/taskRouting.test.ts`

**Interfaces:**

```ts
export type TaskIntent =
  | "simple_qa"
  | "simple_text"
  | "simple_code"
  | "complex_code"
  | "media_script";

export type ModelLane = "light" | "premium";
export type TaskExecutionMode = "read_only" | "agentic";
export type RouteConfidence = "high" | "medium";
export type RouteReasonCode =
  | "simple-question"
  | "text-transform"
  | "code-explanation"
  | "project-change"
  | "multi-step-code"
  | "media-generation"
  | "ambiguous-premium-default";

export interface RouteDecision {
  intent: TaskIntent;
  lane: ModelLane;
  executionMode: TaskExecutionMode;
  confidence: RouteConfidence;
  reasonCode: RouteReasonCode;
}

export type ModelSelection =
  | { mode: "auto" }
  | { mode: "manual"; providerId: string };

export function classifyTask(prompt: string): RouteDecision;
```

- [ ] **Step 1: Write classifier precedence tests**

Cover Chinese and English prompts, including:

```ts
expect(classifyTask("请解释这段 TypeScript 的作用")).toMatchObject({
  intent: "simple_code",
  lane: "light",
  executionMode: "read_only",
  reasonCode: "code-explanation",
});

expect(classifyTask("修复登录故障，修改多个文件并运行测试")).toMatchObject({
  intent: "complex_code",
  lane: "premium",
  executionMode: "agentic",
});

expect(classifyTask("用 Remotion 制作产品演示视频")).toMatchObject({
  intent: "media_script",
  lane: "premium",
  executionMode: "agentic",
  reasonCode: "media-generation",
});

expect(classifyTask("解释问题并顺便修改代码")).toMatchObject({
  lane: "premium",
  executionMode: "agentic",
});
```

Also prove that translation, polishing, summarization, general questions, and simple error explanations are light/read-only; an unclear prompt is premium/agentic; and length alone does not force premium.

- [ ] **Step 2: Run the focused test and confirm the expected module-not-found failure**

Run: `npx vitest run tests/shared/taskRouting.test.ts`

Expected: FAIL because `src/shared/taskRouting.ts` does not exist.

- [ ] **Step 3: Implement ordered local classification**

Use normalized prompt text and deterministic signal groups. Apply rules in this order:

1. media generation;
2. project mutation/build/test/install/deploy/multi-file/architecture;
3. conflicting light and complex signals;
4. code explanation without mutation;
5. text transforms;
6. common short knowledge questions;
7. ambiguous premium default.

Keep prompt length as one supporting multi-step signal only; never route solely from character count. Return fresh immutable plain objects and perform no I/O.

- [ ] **Step 4: Run classifier and type checks**

Run: `npx vitest run tests/shared/taskRouting.test.ts && npm run build:main`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/taskRouting.ts tests/shared/taskRouting.test.ts
git commit -m "feat: classify tasks for local model routing"
```

---

### Task 2: Migrate SQLite and Persist Routing Metadata

**Files:**
- Modify: `src/main/persistence/database.ts`
- Modify: `src/main/persistence/taskRepository.ts`
- Modify: `src/shared/domain.ts`
- Modify: `tests/main/database.test.ts`
- Modify: `tests/main/taskRepository.test.ts`

**Schema target:**

```sql
ALTER TABLE tasks ADD COLUMN route_decision_json TEXT NOT NULL
  DEFAULT '{"intent":"complex_code","lane":"premium","executionMode":"agentic","confidence":"medium","reasonCode":"ambiguous-premium-default"}';
ALTER TABLE tasks ADD COLUMN selection_mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE tasks ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'agentic';

CREATE TABLE model_routing_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  light_provider_id TEXT REFERENCES providers(id) ON DELETE RESTRICT,
  premium_provider_id TEXT REFERENCES providers(id) ON DELETE RESTRICT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE quick_chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE quick_chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES quick_chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  provider_snapshot_json TEXT,
  route_decision_json TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at INTEGER NOT NULL
);
```

- [ ] **Step 1: Add failing migration and task round-trip tests**

Tests must open:

- a fresh in-memory database;
- a schema-v1 fixture;
- a schema-v2 fixture containing an existing project task;
- the resulting schema-v3 database twice to prove idempotent startup.

Assert v2 tasks hydrate as:

```ts
expect(task).toMatchObject({
  selectionMode: "manual",
  executionMode: "agentic",
  routeDecision: {
    lane: "premium",
    executionMode: "agentic",
    reasonCode: "ambiguous-premium-default",
  },
});
```

Assert Quick Chat foreign keys cascade and routing-role provider deletion is restricted.

- [ ] **Step 2: Run the focused persistence tests and confirm schema failures**

Run: `npx vitest run tests/main/database.test.ts tests/main/taskRepository.test.ts`

Expected: FAIL because schema v3 columns/tables and domain fields are absent.

- [ ] **Step 3: Implement sequential schema migration**

Set `SCHEMA_VERSION = 3`. Replace the current single conditional with sequential steps:

```ts
let version = current?.version ?? 0;
createBaseTables(database);
if (version === 0) {
  database.prepare("INSERT INTO schema_version(version) VALUES (3)").run();
  return;
}
if (version === 1) {
  migrateV1ToV2(database);
  version = 2;
}
if (version === 2) {
  migrateV2ToV3(database);
  version = 3;
}
if (version !== SCHEMA_VERSION) {
  throw new Error(`Unsupported ZoroCoding database schema ${version}`);
}
```

Preserve `openDatabaseWithRecovery` behavior: backup a failed file migration, reopen read-only if possible, and never silently create replacement data on the Mac.

- [ ] **Step 4: Extend domain and repository validation**

Add Zod schemas for `RouteDecision`, `ModelSelection`, and `TaskExecutionMode`. Extend `TaskSnapshot` with:

```ts
routeDecision: RouteDecision;
selectionMode: "auto" | "manual";
executionMode: TaskExecutionMode;
```

Read and write all three new task columns in `TaskRepository`. Do not derive these values later from the mutable routing configuration.

- [ ] **Step 5: Run persistence, reducer, and build tests**

Run: `npx vitest run tests/main/database.test.ts tests/main/taskRepository.test.ts tests/main/taskReducer.test.ts && npm run build:main`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/domain.ts src/main/persistence/database.ts src/main/persistence/taskRepository.ts tests/main/database.test.ts tests/main/taskRepository.test.ts
git commit -m "feat: persist model routing and quick chat schema"
```

---

### Task 3: Add Routing Configuration and Authoritative Provider Resolution

**Files:**
- Create: `src/main/persistence/modelRoutingRepository.ts`
- Create: `src/main/routing/modelRouter.ts`
- Create: `tests/main/modelRoutingRepository.test.ts`
- Create: `tests/main/modelRouter.test.ts`
- Modify: `src/main/models/modelGateway.ts`

**Interfaces:**

```ts
export interface ModelRoutingConfig {
  lightProviderId: string | null;
  premiumProviderId: string | null;
  updatedAt: number;
}

export interface ResolvedRoute {
  decision: RouteDecision;
  selectionMode: "auto" | "manual";
  provider: ProviderSnapshot;
}

export class ModelRouter {
  resolve(input: {
    prompt: string;
    selection: ModelSelection;
  }): ResolvedRoute;
}
```

- [ ] **Step 1: Write failing repository bootstrap tests**

Seed provider rows containing the existing named Groq and KIMI K3 configurations. Assert:

- `bootstrap()` selects Groq for `lightProviderId`;
- `bootstrap()` selects a `kind === "kimi"` and KIMI K3-named provider for `premiumProviderId`;
- a missing exact role stays `null`;
- a generic custom provider is never guessed;
- `update()` requires existing provider IDs;
- deleting an assigned provider fails until the role changes.

- [ ] **Step 2: Write failing resolver tests**

Assert:

```ts
expect(router.resolve({
  prompt: "翻译成英文",
  selection: { mode: "auto" },
})).toMatchObject({
  decision: { lane: "light", executionMode: "read_only" },
  selectionMode: "auto",
  provider: { id: groq.id },
});

expect(router.resolve({
  prompt: "修复并运行测试",
  selection: { mode: "manual", providerId: groq.id },
})).toMatchObject({
  decision: { lane: "premium", executionMode: "agentic" },
  selectionMode: "manual",
  provider: { id: groq.id },
});
```

Also assert explicit errors for an unconfigured lane and a deleted/manual unknown provider.

- [ ] **Step 3: Run focused tests and confirm failures**

Run: `npx vitest run tests/main/modelRoutingRepository.test.ts tests/main/modelRouter.test.ts`

Expected: FAIL because the repository and resolver do not exist.

- [ ] **Step 4: Implement the singleton repository**

Use row `id = 1`. `bootstrap(providers, now)` may initialize only empty role fields and must never overwrite a user-selected role. Matching is case-insensitive but requires:

- light: normalized provider name equals `Groq`;
- premium: `kind === "kimi"` and normalized provider name equals `KIMI K3`.

Return provider IDs only; never read or write secrets.

- [ ] **Step 5: Implement authoritative resolution**

`ModelRouter.resolve()` calls `classifyTask(prompt)` every time. In auto mode it reads the current lane role. In manual mode it resolves the explicit provider. It never changes `decision.executionMode`, never mutates provider config, and never falls back.

Add a read-only `ModelGateway.getProviderSnapshot(id)` that returns only `ProviderSnapshot`. Keep `secretRef`, headers, key suffix, health metadata, and API-key resolution inside `ModelGateway`.

- [ ] **Step 6: Run route and provider lifecycle tests**

Run: `npx vitest run tests/main/modelRoutingRepository.test.ts tests/main/modelRouter.test.ts tests/main/modelGateway.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/persistence/modelRoutingRepository.ts src/main/routing/modelRouter.ts src/main/models/modelGateway.ts tests/main/modelRoutingRepository.test.ts tests/main/modelRouter.test.ts
git commit -m "feat: resolve automatic model roles locally"
```

---

### Task 4: Make Project Task Routing Authoritative in IPC and Persistence

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc/registerIpc.ts`
- Modify: `src/main/agent/agentRuntime.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/main/ipc.test.ts`
- Modify: `tests/main/agentRuntime.test.ts`
- Modify: `tests/main/fullWorkflow.test.ts`

**Request contract:**

```ts
export interface CreateTaskRequest {
  projectId: string;
  prompt: string;
  selection: ModelSelection;
}

export interface RoutingConfigView {
  lightProviderId: string | null;
  premiumProviderId: string | null;
  updatedAt: number;
}

export interface RoutePreviewRequest {
  prompt: string;
  selection: ModelSelection;
}

export interface ResolvedRouteView {
  decision: RouteDecision;
  selectionMode: "auto" | "manual";
  provider: ProviderSnapshot;
}
```

- [ ] **Step 1: Add failing strict IPC tests**

Prove that:

- `{ selection: { mode: "auto" } }` is accepted;
- manual mode requires `providerId`;
- renderer-supplied `routeDecision`, `executionMode`, `projectPath`, `tools`, and extra keys are rejected;
- route preview returns the same local classification/provider resolution without starting a task or calling a model;
- main process recomputes the route and stores the selected provider snapshot;
- update-routing rejects missing providers;
- removing a routed provider returns a clear “先更换路由模型” error.

- [ ] **Step 2: Add failing runtime snapshot tests**

Extend the runtime input:

```ts
export interface CreateTaskInput {
  project: ProjectSummary;
  prompt: string;
  provider: ProviderSnapshot;
  routeDecision: RouteDecision;
  selectionMode: "auto" | "manual";
}
```

Assert the created task retains route metadata after pause, resume, retry, messages, and reload.

- [ ] **Step 3: Run IPC/runtime tests and confirm failures**

Run: `npx vitest run tests/main/ipc.test.ts tests/main/agentRuntime.test.ts tests/main/fullWorkflow.test.ts`

Expected: FAIL at the old `providerId` request shape and missing metadata.

- [ ] **Step 4: Update schemas and handler wiring**

Define a discriminated `modelSelectionSchema` and keep every object `.strict()`. Add:

```ts
routing: {
  get(): Promise<RoutingConfigView>;
  update(input: {
    lightProviderId: string;
    premiumProviderId: string;
  }): Promise<RoutingConfigView>;
  preview(input: RoutePreviewRequest): Promise<ResolvedRouteView>;
}
```

The task-create handler must:

1. validate the request;
2. load and canonicalize the authorized project;
3. call `ModelRouter.resolve()` in the main process;
4. use the already secret-free resolved `ProviderSnapshot` unchanged;
5. call `AgentRuntime.createTask()` with route metadata.

Do not add an IPC endpoint that accepts or returns API keys for routing.

- [ ] **Step 5: Wire main-process dependencies**

Construct `ModelRoutingRepository`, bootstrap roles after providers are available, construct `ModelRouter`, and pass both into IPC registration. Preserve existing storage generation and read-only recovery gates.

- [ ] **Step 6: Run the focused and integration tests**

Run: `npx vitest run tests/main/ipc.test.ts tests/main/agentRuntime.test.ts tests/main/fullWorkflow.test.ts && npm run build:main`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/main/ipc/registerIpc.ts src/main/agent/agentRuntime.ts src/main/index.ts tests/main/ipc.test.ts tests/main/agentRuntime.test.ts tests/main/fullWorkflow.test.ts
git commit -m "feat: route project tasks through main process"
```

---

### Task 5: Enforce Read-Only Project Tools in the Main Process

**Files:**
- Modify: `src/shared/domain.ts`
- Modify: `src/main/tools/fileTools.ts`
- Modify: `src/main/tools/toolRegistry.ts`
- Modify: `src/main/agent/agentRuntime.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/main/fileTools.test.ts`
- Modify: `tests/main/toolRegistry.test.ts`
- Modify: `tests/main/agentRuntime.test.ts`
- Modify: `tests/main/fullWorkflow.test.ts`

**Factory contract:**

```ts
type CreateTools = (
  projectRoot: string,
  executionMode: TaskExecutionMode,
  requestApproval: ApprovalRequester,
) => ToolRegistry;
```

- [ ] **Step 1: Add failing registry capability tests**

Construct both modes. Assert:

```ts
expect(readOnly.definitions.map((item) => item.function.name)).toEqual([
  "list_files",
  "read_file",
  "search_files",
]);
expect(agentic.definitions.map((item) => item.function.name)).toEqual([
  "list_files",
  "read_file",
  "search_files",
  "write_file",
  "run_shell",
]);
```

Call `write_file` and `run_shell` directly against the read-only registry to prove defense in depth. Both calls must return `{ ok: false, denied: true }`; approval, file-write, and shell fakes must have zero calls.

- [ ] **Step 2: Add failing bounded file-list tests**

Add `FileTools.list(path = ".")` and prove it:

- returns sorted project-relative files and directories;
- skips `.git`, dependencies, and build-output directories;
- never follows symbolic links;
- rejects paths outside the canonical project root;
- aborts promptly;
- caps output at a documented maximum such as 500 entries.

Add `"list_files"` to `ToolName` and its Zod schemas. Its input is `{ path?: string }`; its result contains paths only, never file contents.

- [ ] **Step 3: Add failing runtime request tests**

Use a fake model that attempts a write and a shell call in a read-only task. Assert:

- the model request advertises only list/read/search tools;
- forged write/shell tool calls produce visible denied tool events;
- no approval event appears;
- no file or command side effect occurs;
- the read-only system prompt says it may inspect and explain but must not claim to modify or execute;
- an agentic task still exercises the existing approval flow.

- [ ] **Step 4: Run the focused tests and confirm failures**

Run: `npx vitest run tests/main/fileTools.test.ts tests/main/toolRegistry.test.ts tests/main/agentRuntime.test.ts tests/main/fullWorkflow.test.ts`

Expected: FAIL because the existing tools are always exposed and write/shell remain executable.

- [ ] **Step 5: Implement bounded listing, filter definitions, and deny forbidden calls before parsing**

Move definitions to module-level constants, then select them in the constructor:

```ts
this.definitions =
  executionMode === "read_only"
    ? ALL_DEFINITIONS.filter(({ function: tool }) =>
        ["list_files", "read_file", "search_files"].includes(tool.name))
    : ALL_DEFINITIONS;
```

At the beginning of `execute()`:

```ts
if (
  this.executionMode === "read_only" &&
  (call.name === "write_file" || call.name === "run_shell")
) {
  return this.denied(
    call,
    call.name === "run_shell"
      ? "只读任务不允许运行终端命令。"
      : "只读任务不允许修改文件。",
  );
}
```

This denial must happen before Zod parsing, permission assessment, approval, or side-effect code.

- [ ] **Step 6: Thread the persisted mode through every runtime path**

Pass `task.executionMode` when starting, resuming, retrying, or continuing a task. Do not reclassify an existing task. On process restart, the persisted snapshot determines tool capability.

Select the system prompt from the persisted mode:

```ts
const READ_ONLY_SYSTEM =
  "你是 ZoroCoding 项目只读助手。你可以列出、搜索和读取当前项目中的文件并回答问题；不得修改文件、运行命令或声称已执行这些操作。";
```

Keep the existing coding-agent prompt for `agentic` tasks.

- [ ] **Step 7: Run security-focused tests**

Run: `npx vitest run tests/main/fileTools.test.ts tests/main/toolRegistry.test.ts tests/main/agentRuntime.test.ts tests/main/fullWorkflow.test.ts tests/main/securityGates.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/domain.ts src/main/tools/fileTools.ts src/main/tools/toolRegistry.ts src/main/agent/agentRuntime.ts src/main/index.ts tests/main/fileTools.test.ts tests/main/toolRegistry.test.ts tests/main/agentRuntime.test.ts tests/main/fullWorkflow.test.ts
git commit -m "feat: enforce read-only project task capabilities"
```

---

### Task 6: Build Quick Chat Persistence

**Files:**
- Modify: `src/shared/domain.ts`
- Create: `src/main/persistence/quickChatRepository.ts`
- Create: `tests/main/quickChatRepository.test.ts`

**Domain contracts:**

```ts
export type QuickChatMessageStatus =
  | "streaming"
  | "completed"
  | "failed"
  | "canceled";

export interface QuickChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface QuickChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  providerSnapshot: ProviderSnapshot | null;
  routeDecision: RouteDecision | null;
  status: QuickChatMessageStatus;
  errorMessage: string | null;
  createdAt: number;
}
```

- [ ] **Step 1: Write failing repository tests**

Assert create/list/get/rename/delete session behavior, chronological messages, streaming-to-completed updates, failure persistence, immutable provider and route JSON, cascading delete, and live-write-gate denial after storage loss.

Also prove repository hydration rejects invalid JSON/status rows through Zod rather than returning unvalidated data.

- [ ] **Step 2: Run the repository test and confirm failure**

Run: `npx vitest run tests/main/quickChatRepository.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement the repository**

Use prepared statements and `database.transaction()` for:

- `createSession(session)`;
- `renameSession(id, title, updatedAt)`;
- `deleteSession(id)`;
- `listSessions()`;
- `getSession(id)`;
- `insertMessage(message)`;
- `updateAssistantMessage(id, patch)`;
- `listMessages(sessionId)`.

Apply the same `LiveWriteGate` used by task/provider repositories. Do not add project-related columns.

- [ ] **Step 4: Run persistence tests**

Run: `npx vitest run tests/main/quickChatRepository.test.ts tests/main/database.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/domain.ts src/main/persistence/quickChatRepository.ts tests/main/quickChatRepository.test.ts
git commit -m "feat: persist no-project quick chat history"
```

---

### Task 7: Implement the Tool-Free QuickChatService

**Files:**
- Create: `src/main/quick-chat/quickChatService.ts`
- Create: `tests/main/quickChatService.test.ts`
- Modify: `src/main/index.ts`

**Service contract:**

```ts
export type QuickChatEvent =
  | { type: "session_updated"; session: QuickChatSession }
  | { type: "message_started"; message: QuickChatMessage }
  | { type: "message_delta"; sessionId: string; messageId: string; text: string }
  | { type: "message_completed"; message: QuickChatMessage }
  | { type: "message_failed"; message: QuickChatMessage };

export class QuickChatService {
  send(input: {
    sessionId: string;
    prompt: string;
    selection: ModelSelection;
  }): Promise<QuickChatMessage>;
  cancel(sessionId: string): Promise<void>;
  retry(input: {
    sessionId: string;
    messageId: string;
    selection: ModelSelection;
  }): Promise<QuickChatMessage>;
  subscribe(listener: (event: QuickChatEvent) => void): () => void;
  interruptForStorageLoss(): Promise<void>;
}
```

- [ ] **Step 1: Write failing tool-isolation tests**

Use fake repositories, router, and gateway. Assert:

- `ModelGateway.stream()` receives `tools: []`;
- request messages contain only system/user/assistant conversation text;
- no `ToolRegistry`, `FileTools`, `ShellTool`, project root, or project ID is a constructor argument;
- a returned model `tool_call` event fails safely and is not executed;
- only the provider resolved at send/retry start is called;
- rate-limit or network errors save `failed` and never invoke another provider;
- cancel aborts the active request and saves `canceled`;
- storage loss aborts every stream and stops writes;
- media intent remains tool-free and emits data the UI can use for “转为项目任务”.

- [ ] **Step 2: Add conversation and retry tests**

Prove:

- first send creates a user message and a streaming assistant row before requesting the model;
- deltas update in memory/events and final content persists;
- follow-up requests include completed prior messages only;
- retry uses the original user prompt, creates a new assistant result, and uses the explicitly resolved provider for that retry;
- session title is derived locally from the first prompt and truncated safely.

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `npx vitest run tests/main/quickChatService.test.ts`

Expected: FAIL because `QuickChatService` does not exist.

- [ ] **Step 4: Implement the independent service**

Use this fixed system message:

```ts
const QUICK_CHAT_SYSTEM = [
  "你是 ZoroCoding 快速问答助手。",
  "本会话没有项目、文件或终端访问能力。",
  "不要声称已经读取、修改或运行本地内容。",
  "需要落盘、绘图或视频生成时，建议用户转为项目任务。",
].join("\n");
```

Call:

```ts
this.modelGateway.stream(provider.id, {
  messages,
  tools: [],
  signal: controller.signal,
});
```

On `tool_call`, throw a safe invalid-response error. Never import from `../tools`, and never automatically re-resolve after a stream starts.

- [ ] **Step 5: Wire storage interruption**

Create the service in `src/main/index.ts`. During the existing ORICO disconnect path, call both `agentRuntime.interruptForStorageLoss()` and `quickChatService.interruptForStorageLoss()` before closing persistence.

- [ ] **Step 6: Run service, gateway, and storage tests**

Run: `npx vitest run tests/main/quickChatService.test.ts tests/main/modelGateway.test.ts tests/main/storageLifecycle.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/quick-chat/quickChatService.ts src/main/index.ts tests/main/quickChatService.test.ts
git commit -m "feat: add tool-free quick chat service"
```

---

### Task 8: Expose Strict Routing and Quick Chat IPC

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc/registerIpc.ts`
- Modify: `src/preload/index.ts`
- Modify: `tests/main/ipc.test.ts`
- Modify: `tests/main/preload.test.ts`

**Preload contract:**

```ts
export interface ZoroApi {
  // existing app/projects/tasks/providers...
  routing: {
    get(): Promise<RoutingConfigView>;
    update(input: UpdateRoutingConfigRequest): Promise<RoutingConfigView>;
    preview(input: RoutePreviewRequest): Promise<ResolvedRouteView>;
  };
  quickChat: {
    listSessions(): Promise<QuickChatSession[]>;
    createSession(): Promise<QuickChatSession>;
    renameSession(sessionId: string, title: string): Promise<QuickChatSession>;
    deleteSession(sessionId: string): Promise<void>;
    listMessages(sessionId: string): Promise<QuickChatMessage[]>;
    send(input: QuickChatSendRequest): Promise<QuickChatMessage>;
    cancel(sessionId: string): Promise<void>;
    retry(input: QuickChatRetryRequest): Promise<QuickChatMessage>;
    subscribe(listener: (event: QuickChatEventEnvelope) => void): () => void;
  };
}
```

- [ ] **Step 1: Add failing strict-schema tests**

Create `.strict()` Zod schemas for all endpoints. Explicitly test that Quick Chat send/retry rejects:

```ts
{
  sessionId,
  prompt: "hello",
  selection: { mode: "auto" },
  projectId: "forbidden",
  projectPath: "/tmp",
  command: "pwd",
  tools: [],
}
```

Also test trimmed/max-length prompts, missing sessions, invalid provider IDs, storage unavailable, and duplicate subscription IDs.

- [ ] **Step 2: Add failing preload allowlist/freeze tests**

Assert only named routing/Quick Chat channels are callable, listener payloads are cloned/validated, unsubscribe removes exactly the matching listener, and `window.zoro`, `routing`, and `quickChat` are frozen.

- [ ] **Step 3: Run focused IPC tests and confirm failures**

Run: `npx vitest run tests/main/ipc.test.ts tests/main/preload.test.ts`

Expected: FAIL because the namespaces and channels are absent.

- [ ] **Step 4: Implement validated handlers**

Handlers call repositories/services only after storage and schema checks. Subscription envelopes include a generated `subscriptionId`; the preload drops mismatched events. Never expose raw provider config `secretRef`, model response headers, project paths, or API keys.

- [ ] **Step 5: Implement the frozen preload API**

Follow the existing strict task subscription pattern. Use explicit channels rather than a generic `invoke(channel, payload)` bridge.

- [ ] **Step 6: Run IPC, preload, and security tests**

Run: `npx vitest run tests/main/ipc.test.ts tests/main/preload.test.ts tests/main/securityGates.test.ts && npm run build:preload`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/main/ipc/registerIpc.ts src/preload/index.ts tests/main/ipc.test.ts tests/main/preload.test.ts
git commit -m "feat: expose secure routing and quick chat api"
```

---

### Task 9: Add Automatic Routing to Project Task and Settings UI

**Files:**
- Modify: `src/renderer/components/NewTaskDialog.tsx`
- Modify: `src/renderer/components/SettingsView.tsx`
- Modify: `src/renderer/components/Workbench.tsx`
- Modify: `src/renderer/state/useZoroStore.ts`
- Modify: `src/renderer/App.tsx`
- Create: `tests/renderer/RoutingSettings.test.tsx`
- Modify: `tests/renderer/App.test.tsx`
- Modify: `tests/renderer/SettingsView.test.tsx`

**Visible route copy:**

```ts
const INTENT_LABELS: Record<TaskIntent, string> = {
  simple_qa: "简单问答",
  simple_text: "文字处理",
  simple_code: "代码解释",
  complex_code: "复杂代码",
  media_script: "绘图 / 视频脚本",
};
```

- [ ] **Step 1: Add failing new-task route preview tests**

Test this sequence:

1. dialog defaults to `自动选择（推荐）`;
2. typing “解释 package.json” displays light provider name and `只读问答`;
3. typing “修改登录并运行测试” displays KIMI K3 and `完整执行`;
4. choosing a concrete provider changes only the model copy;
5. safety-mode copy remains classifier-derived;
6. submission sends `{ projectId, prompt, selection }`, not route data;
7. a missing lane role disables submission and offers “前往设置”.

- [ ] **Step 2: Add failing settings route-role tests**

Render configured providers and assert the “自动模型路由” section:

- shows light and premium dropdowns;
- starts with Groq and KIMI K3;
- saves both IDs together;
- never displays a key or `secretRef`;
- prevents an empty role;
- refreshes the task dialog after changes.

- [ ] **Step 3: Add failing task-detail snapshot tests**

The workbench header must show the persisted task values:

```text
已识别：复杂代码
选择方式：自动
实际模型：KIMI K3 · <model id>
执行方式：完整执行
```

It must not recalculate historical tasks when route settings change.

- [ ] **Step 4: Run renderer tests and confirm failures**

Run: `npx vitest run tests/renderer/RoutingSettings.test.tsx tests/renderer/App.test.tsx tests/renderer/SettingsView.test.tsx`

Expected: FAIL because the renderer still submits `providerId` directly.

- [ ] **Step 5: Implement route preview and selection**

Use the shared pure classifier for immediate intent/safety copy and `window.zoro.routing.preview()` to resolve the displayed provider without calling a model. Debounce/cancel stale preview requests. The main process recomputes the final route again at submit time.

Keep the selected project mandatory for this dialog. Add an optional `initialPrompt` prop so a media Quick Chat can open this same flow without bypassing project choice.

- [ ] **Step 6: Implement routing settings and historical detail**

Load config through `window.zoro.routing.get()`. Save role changes through one update call. Display task route/provider data from `TaskSnapshot`, not from current settings.

- [ ] **Step 7: Run focused renderer and build tests**

Run: `npx vitest run tests/renderer/RoutingSettings.test.tsx tests/renderer/App.test.tsx tests/renderer/SettingsView.test.tsx && npm run build:renderer`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/NewTaskDialog.tsx src/renderer/components/SettingsView.tsx src/renderer/components/Workbench.tsx src/renderer/state/useZoroStore.ts src/renderer/App.tsx tests/renderer/RoutingSettings.test.tsx tests/renderer/App.test.tsx tests/renderer/SettingsView.test.tsx
git commit -m "feat: show automatic routing in project tasks"
```

---

### Task 10: Add the No-Project Quick Chat UI

**Files:**
- Create: `src/renderer/components/QuickChatView.tsx`
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/state/useZoroStore.ts`
- Modify: `src/renderer/App.tsx`
- Create: `tests/renderer/QuickChatView.test.tsx`
- Modify: `tests/renderer/App.test.tsx`

**View state:**

```ts
export type AppView = "workbench" | "quick_chat" | "settings";
```

- [ ] **Step 1: Write failing Quick Chat component tests**

Assert:

- sidebar entry “快速问答” is usable with zero projects;
- first open creates/selects a session without opening project selection;
- session history loads after remount;
- prompt route preview shows light/K3 and the reason;
- auto/manual model selector has the same semantics as project tasks;
- send renders user text, streaming assistant deltas, completed output, and actual model;
- cancel and retry call their exact API methods;
- errors retain the failed provider and offer retry/change-model choices;
- no file, project-path, terminal, permission, or progress controls exist.

- [ ] **Step 2: Write failing media-conversion tests**

For a media route, render:

```text
此处只能生成方案或代码，不能直接创建本地文件。
[转为项目任务]
```

Clicking the action must open `NewTaskDialog` with the original prompt, but no preselected/forged project ID; the user still chooses an authorized project.

- [ ] **Step 3: Run renderer tests and confirm failure**

Run: `npx vitest run tests/renderer/QuickChatView.test.tsx tests/renderer/App.test.tsx`

Expected: FAIL because the view and state do not exist.

- [ ] **Step 4: Implement Quick Chat store state**

Track:

- sessions and active session ID;
- active session messages;
- streaming text by assistant message ID;
- Quick Chat selection and route preview;
- unsubscribe lifecycle;
- pending conversion prompt.

On storage disconnect, close send controls and clear only volatile streaming state; keep persisted history available after the required restart.

- [ ] **Step 5: Implement the view and navigation**

Use a normal conversation layout with session create/rename/delete, message list, prompt field, route/model preview, send, cancel, and retry. All text comes from persisted/streamed events. Do not add renderer APIs for filesystem or terminal access.

- [ ] **Step 6: Run renderer tests and build**

Run: `npx vitest run tests/renderer/QuickChatView.test.tsx tests/renderer/App.test.tsx && npm run build:renderer`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/QuickChatView.tsx src/renderer/components/Sidebar.tsx src/renderer/state/useZoroStore.ts src/renderer/App.tsx tests/renderer/QuickChatView.test.tsx tests/renderer/App.test.tsx
git commit -m "feat: add no-project quick chat interface"
```

---

### Task 11: Add Semantic Code and Terminal Output Components

**Files:**
- Create: `src/renderer/components/CodePatch.tsx`
- Create: `src/renderer/components/TerminalOutput.tsx`
- Modify: `src/renderer/components/Workbench.tsx`
- Modify: `src/renderer/components/ProgressPanel.tsx`
- Create: `tests/renderer/OutputBlocks.test.tsx`
- Modify: `tests/renderer/ProgressPanel.test.tsx`

**Interfaces:**

```ts
export function CodePatch({ patch }: { patch: string }): JSX.Element;

export function TerminalOutput(props: {
  text: string;
  status?: "normal" | "error" | "waiting";
  label?: string;
}): JSX.Element;
```

- [ ] **Step 1: Write failing semantic output tests**

Verify `CodePatch` classifies:

- file headers/hunk headers as `diff-meta`;
- `+` lines as `diff-add`;
- `-` lines as `diff-remove`;
- context as `diff-context`;
- empty lines remain copyable.

Verify `TerminalOutput`:

- preserves whitespace;
- labels error as `✕ 错误`;
- labels waiting as `… 等待`;
- never changes or truncates returned command text.

- [ ] **Step 2: Run focused tests and confirm module failures**

Run: `npx vitest run tests/renderer/OutputBlocks.test.tsx tests/renderer/ProgressPanel.test.tsx`

Expected: FAIL because the semantic components do not exist.

- [ ] **Step 3: Implement semantic rendering without colors**

Components own text structure, status labels, and CSS class names only. They must not contain inline colors, styles, HTML injection, or a multi-color syntax-highlighting dependency.

- [ ] **Step 4: Replace raw output `<pre>` blocks**

Use `CodePatch` for persisted file changes and `TerminalOutput` for task events, live command output, and the progress drawer. Preserve scrolling, wrapping, selection, and copy behavior.

- [ ] **Step 5: Run component tests**

Run: `npx vitest run tests/renderer/OutputBlocks.test.tsx tests/renderer/ProgressPanel.test.tsx tests/renderer/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/CodePatch.tsx src/renderer/components/TerminalOutput.tsx src/renderer/components/Workbench.tsx src/renderer/components/ProgressPanel.tsx tests/renderer/OutputBlocks.test.tsx tests/renderer/ProgressPanel.test.tsx
git commit -m "feat: render semantic black-green output blocks"
```

---

### Task 12: Enforce the Strict Black-Green Visual Contract

**Files:**
- Create: `tests/renderer/themeContract.test.ts`
- Modify: `src/renderer/styles.css`
- Modify: `src/main/createWindow.ts`
- Modify: `tests/main/createWindow.test.ts`

**Approved tokens:**

```css
:root {
  color-scheme: dark;
  --zoro-black: #000000;
  --zoro-green: #c9ff62;
}
```

- [ ] **Step 1: Write the failing static renderer color scanner**

Recursively scan `src/renderer/**/*.{css,ts,tsx,svg}`. Allow only case-insensitive `#000000` and `#c9ff62`. Reject:

- all other hex colors;
- `rgb()`, `rgba()`, `hsl()`, and `hsla()`;
- standalone named colors including `white`, `black`, `red`, `yellow`, `blue`, `gray`, `green`, and `transparent` while allowing those words inside identifiers such as `--zoro-black`;
- gradients;
- `box-shadow` and `text-shadow`;
- `opacity` values other than `1`;
- inline `style={{ color/background... }}`.

Assert required output and dialog selectors use both approved tokens.

- [ ] **Step 2: Add the failing first-frame test**

Extend `tests/main/createWindow.test.ts`:

```ts
expect(BrowserWindow).toHaveBeenCalledWith(
  expect.objectContaining({
    backgroundColor: "#000000",
  }),
);
```

- [ ] **Step 3: Run theme/window tests and confirm current color failures**

Run: `npx vitest run tests/renderer/themeContract.test.ts tests/main/createWindow.test.ts`

Expected: FAIL on existing white/gray/status colors and white BrowserWindow background.

- [ ] **Step 4: Replace the CSS token system**

Make `src/renderer/styles.css` the only renderer color source. Use:

- black backgrounds and green text/borders/icons by default;
- primary controls: green background, black text;
- hover/selected: inverted green/black;
- focus: green double outline;
- disabled: black/green with dashed border and no lowered opacity;
- success: `✓` and solid border;
- warning: `△` and dashed border;
- error: `✕` and double border;
- waiting: `…` and dotted border;
- no shadows, gradients, transparency, or third colors.

Set all AI, Quick Chat, terminal, code, and diff surfaces to black background and green text. Use solid/double/dotted left borders for add/remove/context lines.

- [ ] **Step 5: Set the Electron first frame to black**

Change only the window background and app-controlled title-bar surface. Preserve native macOS traffic lights, sandbox, context isolation, preload path, and current window behavior.

- [ ] **Step 6: Run renderer, window, and build tests**

Run: `npx vitest run tests/renderer/themeContract.test.ts tests/renderer/OutputBlocks.test.tsx tests/main/createWindow.test.ts tests/renderer/App.test.tsx && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/styles.css src/main/createWindow.ts tests/renderer/themeContract.test.ts tests/main/createWindow.test.ts
git commit -m "feat: apply strict black-green desktop theme"
```

---

### Task 13: Verify the Full Workflow, Package, and Reinstall on ORICO

**Files:**
- Modify: `tests/e2e/app.spec.ts`
- Modify: `docs/superpowers/plans/2026-07-28-routing-quick-chat-black-green.md`
- Modify: `/Users/vion/Documents/Codex/2026-07-28/1-codex-2-zorocoding-3-3/outputs/ZoroCoding-安装与验收说明.md`

- [x] **Step 1: Add failing Electron end-to-end routing tests**

Use the existing deterministic mock model server and isolated E2E data root. Cover:

1. a simple project prompt automatically chooses the light provider;
2. its task shows `只读问答`;
3. attempted write/shell calls are denied with no project mutation;
4. a complex prompt automatically chooses KIMI K3 and completes the normal write/approval/progress chain;
5. manual provider override changes provider but not execution mode;
6. the selected provider remains fixed on simulated failure;
7. the task detail keeps route/provider snapshot after relaunch.

- [x] **Step 2: Add failing Quick Chat end-to-end tests**

Cover:

1. Quick Chat opens with no project;
2. a simple prompt streams a light response and persists after relaunch;
3. no project picker/terminal/file controls appear;
4. complex Quick Chat uses K3 but stays tool-free;
5. a media prompt offers “转为项目任务” and then requires project selection;
6. cancel, retry, missing-role, and storage-loss states remain safe.

- [x] **Step 3: Add failing computed-style checks**

Across loading, workbench, Quick Chat, settings, new task, approval, progress, error, terminal, and diff surfaces, evaluate computed:

- `color`;
- `backgroundColor`;
- `border*Color`;
- `outlineColor`;
- SVG `stroke`/`fill`.

Every app-controlled non-empty color must resolve to `rgb(0, 0, 0)` or `rgb(201, 255, 98)`. Assert `document.documentElement.style.colorScheme` or computed `color-scheme` is dark and capture final screenshots.

- [ ] **Step 4: Run the full local release gates**

Run:

```bash
npm test
npm run build
npm run test:e2e
npm run verify
npm run package:mac
```

Expected: all PASS; generated macOS app is `arm64`, version `0.2.0`.

- [x] **Step 5: Audit the packaged app before installation**

Verify:

- archive/executable architecture is arm64;
- `asar` contains the new strict preload and no plaintext API keys;
- packaged renderer passes the two-color source scan;
- provider metadata and secret references are not bundled into source;
- signing/Gatekeeper state is reported accurately.

Never print, copy, or log raw API keys during this audit.

- [ ] **Step 6: Request the exact external-drive write permission and install recoverably**

Resolve `/Volumes/ORICO` with a read-only check. Request write access only for:

- `/Volumes/ORICO/ZoroCoding.app`;
- a uniquely named staging/rollback path on `/Volumes/ORICO`;
- `/Volumes/ORICO/ZoroCodingData` only if metadata verification needs it.

Copy the packaged app to staging, validate it, move the current app to a recoverable same-volume rollback name, then move staging into `/Volumes/ORICO/ZoroCoding.app`. Never delete or overwrite `/Volumes/ORICO/ZoroCoding 0.1.0 Backup.app` or the data directory.

- [ ] **Step 7: Verify real ORICO preservation without exposing secrets**

With the production app closed, read only safe metadata and assert:

- 9 provider rows remain;
- exactly 1 provider is marked default;
- the default remains KIMI K3;
- 9 non-empty `secret_ref` values exist;
- 9 encrypted secret files exist;
- routing config points light to Groq and premium to KIMI K3;
- application/data/projects paths are on ORICO;
- no API key value appears in source, logs, screenshots, or handoff docs.

- [ ] **Step 8: Launch the installed app and perform smoke tests**

Verify on the installed app:

- no white flash or third app color;
- project task progress bar and remaining-time countdown still work;
- simple project task is read-only/light;
- complex project task is K3/agentic;
- Quick Chat works with no project;
- output/code/terminal are black with green text;
- settings can change both route roles;
- provider add/update/remove safety still works;
- ORICO disconnect remains fail-closed;
- developer console contains no application errors.

- [x] **Step 9: Update handoff documentation**

Record the installed path, data paths, version/architecture, routing behavior, Quick Chat boundary, two-color contract, provider-count verification, rollback app, and test commands. State that API keys are encrypted and deliberately omitted.

- [x] **Step 10: Commit E2E and documentation changes**

```bash
git add tests/e2e/app.spec.ts docs/superpowers/plans/2026-07-28-routing-quick-chat-black-green.md
git commit -m "test: verify routed black-green workflows"
```

Commit the user-facing handoff document from its owning workspace after verifying it contains no secrets.

---

## Final Acceptance Checklist

- [ ] Project task path remains: choose project → submit task → AI changes code → view progress and result.
- [ ] Progress bar and estimated remaining-time countdown remain visible for active project tasks.
- [ ] Local classifier chooses light for simple Q&A/text/code explanation and KIMI K3 for complex code/media scripts.
- [ ] Main process recomputes and persists the route decision.
- [ ] Manual model override cannot increase or reduce classifier-derived tool permissions.
- [ ] Read-only project tasks expose only list/read/search and reject write/shell at the tool boundary.
- [ ] Quick Chat works without a project and has no file/shell capability.
- [ ] Quick Chat sessions and messages persist on ORICO across restart.
- [ ] Provider failure does not trigger silent model fallback.
- [ ] Groq and KIMI K3 roles are user-configurable and protected from unsafe deletion.
- [ ] All app-controlled UI, AI output, code, diff, terminal, dialogs, progress, and Quick Chat are pure black/green.
- [ ] All unit, integration, security, preload, renderer, E2E, build, package, and smoke tests pass.
- [ ] Installed app is `/Volumes/ORICO/ZoroCoding.app`, version `0.2.0`, arm64.
- [ ] Existing 9 providers, KIMI K3 default, encrypted secret files, ORICO data paths, and 0.1.0 backup remain intact.
- [x] No API key is exposed in source, logs, tests, screenshots, commits, or handoff documentation.
