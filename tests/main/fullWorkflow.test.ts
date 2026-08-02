import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../../src/main/agent/agentRuntime";
import { ModelGateway } from "../../src/main/models/modelGateway";
import { openDatabase } from "../../src/main/persistence/database";
import { ProviderRepository } from "../../src/main/persistence/providerRepository";
import { TaskRepository } from "../../src/main/persistence/taskRepository";
import { isProviderReferencedByResumableTask } from "../../src/main/tasks/providerUsage";
import {
  SecretStore,
  type SecretCrypto,
} from "../../src/main/secrets/secretStore";
import { FileTools } from "../../src/main/tools/fileTools";
import { PermissionEngine } from "../../src/main/tools/permissionEngine";
import { ShellTool } from "../../src/main/tools/shellTool";
import { ToolRegistry } from "../../src/main/tools/toolRegistry";
import { startMockModelServer } from "../e2e/fixtures/mockModelServer";

const temporaryDirectories: string[] = [];

const testCrypto: SecretCrypto = {
  encryptString(value) {
    return Buffer.from(
      Buffer.from(value, "utf8").map((byte) => byte ^ 0x5a),
    );
  },
  decryptString(value) {
    return Buffer.from(value.map((byte) => byte ^ 0x5a)).toString("utf8");
  },
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("complete local coding workflow", () => {
  it("keeps failed-task provider authority fixed through retryable execution", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "zoro-authority-project-"));
    const secretPath = await mkdtemp(join(tmpdir(), "zoro-authority-secret-"));
    temporaryDirectories.push(projectPath, secretPath);
    const model = await startMockModelServer();
    const database = openDatabase(":memory:");

    try {
      const tasks = new TaskRepository(database);
      const providers = new ProviderRepository(database);
      const secrets = new SecretStore(secretPath, testCrypto);
      const gateway = new ModelGateway(
        providers,
        secrets,
        fetch,
        (providerId) =>
          isProviderReferencedByResumableTask(tasks, providerId),
      );
      const provider = await gateway.createProvider({
        id: "provider-authority",
        name: "Original",
        kind: "openai-compatible",
        baseUrl: model.baseUrl,
        modelId: "original-model",
        contextLength: 128_000,
        headers: { "x-zoro-e2e-provider": "e2e-kimi-k3" },
        apiKey: "e2e-key",
        isDefault: true,
        now: 1,
      });
      tasks.upsertProject({
        id: "project-authority",
        name: "Authority",
        canonicalPath: projectPath,
        lastOpenedAt: 1,
      });
      tasks.create({
        id: "task-authority",
        projectId: "project-authority",
        title: "Retryable task",
        prompt: "Retry",
        status: "failed",
        providerSnapshot: {
          providerId: provider.id,
          name: provider.name,
          kind: provider.kind,
          baseUrl: provider.baseUrl,
          modelId: provider.modelId,
          contextLength: provider.contextLength,
        },
        routeDecision: {
          intent: "complex_code",
          lane: "premium",
          executionMode: "agentic",
          confidence: "high",
          reasonCode: "project-change",
        },
        selectionMode: "auto",
        executionMode: "agentic",
        progress: {
          percent: 25,
          elapsedSeconds: 1,
          remainingSeconds: null,
          estimationState: "paused",
        },
        currentStepId: null,
        activeSince: null,
        pausedSince: null,
        pauseReason: null,
        createdAt: 1,
        updatedAt: 2,
      });

      await expect(
        gateway.updateProvider(provider.id, {
          name: "Changed",
          kind: "openai-compatible",
          baseUrl: model.baseUrl,
          modelId: "changed-model",
          contextLength: 256_000,
          headers: { "x-zoro-e2e-provider": "e2e-groq" },
          apiKey: "changed-key",
          isDefault: true,
          now: 3,
        }),
      ).rejects.toThrow("任务引用");

      for await (const _event of gateway.stream(provider.id, {
        messages: [{ role: "user", content: "Continue retry" }],
        tools: [],
      })) {
        // Consume the real provider stream to prove the execution identity.
      }
      expect(model.requests.at(-1)).toMatchObject({
        providerId: "e2e-kimi-k3",
        model: "original-model",
        streamed: true,
      });
    } finally {
      database.close();
      await model.close();
    }
  });

  it("plans through the compatible API, edits a file, runs a command, and persists the result", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "zoro-workflow-project-"));
    const secretPath = await mkdtemp(join(tmpdir(), "zoro-workflow-secret-"));
    temporaryDirectories.push(projectPath, secretPath);
    await writeFile(join(projectPath, "version.txt"), "1\n");
    const model = await startMockModelServer();
    const database = openDatabase(":memory:");

    try {
      const tasks = new TaskRepository(database);
      const providers = new ProviderRepository(database);
      const secrets = new SecretStore(secretPath, testCrypto);
      const gateway = new ModelGateway(providers, secrets);
      const provider = await gateway.createProvider({
        id: "provider-1",
        name: "本地测试模型",
        kind: "openai-compatible",
        baseUrl: model.baseUrl,
        modelId: "zoro-e2e",
        contextLength: 128_000,
        headers: { "X-Mock-Force-Rate-Limit": "1" },
        apiKey: "e2e-key",
        isDefault: true,
        now: Date.now(),
      });
      const runtime = new AgentRuntime({
        repository: tasks,
        modelGateway: gateway,
        sleep: async () => {},
        createTools: (projectRoot, executionMode, requestApproval) =>
          new ToolRegistry(
            projectRoot,
            executionMode,
            new FileTools(projectRoot),
            new ShellTool(projectRoot),
            new PermissionEngine(),
            requestApproval,
          ),
      });

      const task = await runtime.createTask({
        project: {
          id: "project-1",
          name: "workflow-fixture",
          canonicalPath: projectPath,
          lastOpenedAt: Date.now(),
        },
        prompt: "更新版本并运行测试",
        provider: {
          providerId: provider.id,
          name: provider.name,
          kind: provider.kind,
          baseUrl: provider.baseUrl,
          modelId: provider.modelId,
          contextLength: provider.contextLength,
        },
        routeDecision: {
          intent: "complex_code",
          lane: "premium",
          executionMode: "agentic",
          confidence: "high",
          reasonCode: "project-change",
        },
        selectionMode: "auto",
      });
      await runtime.waitForIdle();

      const persisted = new TaskRepository(database).get(task.id);
      expect(persisted).toMatchObject({
        status: "completed",
        providerSnapshot: {
          providerId: "provider-1",
          modelId: "zoro-e2e",
        },
        routeDecision: {
          lane: "premium",
          executionMode: "agentic",
        },
        selectionMode: "auto",
        executionMode: "agentic",
        progress: { percent: 100 },
      });
      expect(await readFile(join(projectPath, "version.txt"), "utf8")).toBe(
        "2\n",
      );
      expect(
        tasks
          .events(task.id)
          .filter((event) => event.type === "tool_completed")
          .map((event) =>
            event.type === "tool_completed" ? event.payload.name : "",
          ),
      ).toEqual(["write_file", "run_shell"]);
      expect(JSON.stringify(model.requests)).not.toContain("e2e-key");
    } finally {
      database.close();
      await model.close();
    }
  });

  it("keeps forged write and shell calls side-effect free for a persisted read-only task", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "zoro-readonly-project-"));
    const secretPath = await mkdtemp(join(tmpdir(), "zoro-readonly-secret-"));
    temporaryDirectories.push(projectPath, secretPath);
    await writeFile(join(projectPath, "version.txt"), "1\n");
    const model = await startMockModelServer();
    const database = openDatabase(":memory:");

    try {
      const tasks = new TaskRepository(database);
      const providers = new ProviderRepository(database);
      const secrets = new SecretStore(secretPath, testCrypto);
      const gateway = new ModelGateway(providers, secrets);
      const provider = await gateway.createProvider({
        id: "provider-readonly",
        name: "本地测试模型",
        kind: "openai-compatible",
        baseUrl: model.baseUrl,
        modelId: "zoro-e2e",
        contextLength: 128_000,
        headers: {},
        apiKey: "e2e-key",
        isDefault: true,
        now: Date.now(),
      });
      const runtime = new AgentRuntime({
        repository: tasks,
        modelGateway: gateway,
        sleep: async () => {},
        createTools: (projectRoot, executionMode, requestApproval) =>
          new ToolRegistry(
            projectRoot,
            executionMode,
            new FileTools(projectRoot),
            new ShellTool(projectRoot),
            new PermissionEngine(),
            requestApproval,
          ),
      });

      const task = await runtime.createTask({
        project: {
          id: "project-readonly",
          name: "readonly-fixture",
          canonicalPath: projectPath,
          lastOpenedAt: Date.now(),
        },
        prompt: "检查版本但不要修改",
        provider: {
          providerId: provider.id,
          name: provider.name,
          kind: provider.kind,
          baseUrl: provider.baseUrl,
          modelId: provider.modelId,
          contextLength: provider.contextLength,
        },
        routeDecision: {
          intent: "simple_qa",
          lane: "light",
          executionMode: "read_only",
          confidence: "high",
          reasonCode: "simple-question",
        },
        selectionMode: "auto",
      });
      await runtime.waitForIdle();

      expect(await readFile(join(projectPath, "version.txt"), "utf8")).toBe(
        "1\n",
      );
      const completed = tasks
        .events(task.id)
        .filter((event) => event.type === "tool_completed");
      expect(
        completed.map((event) =>
          event.type === "tool_completed"
            ? {
                name: event.payload.name,
                ok: event.payload.ok,
                denied: event.payload.denied,
              }
            : null,
        ),
      ).toEqual([
        { name: "write_file", ok: false, denied: true },
        { name: "run_shell", ok: false, denied: true },
      ]);
      expect(
        tasks
          .events(task.id)
          .some((event) => event.type === "approval_requested"),
      ).toBe(false);
    } finally {
      database.close();
      await model.close();
    }
  });
});
