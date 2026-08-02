import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/main/persistence/database";
import { TaskRepository } from "../../src/main/persistence/taskRepository";
import type { TaskSnapshot } from "../../src/shared/domain";

const routedTask = {
  id: "task-1",
  projectId: "project-1",
  title: "Explain a function",
  prompt: "Explain this TypeScript function",
  status: "draft",
  providerSnapshot: {
    providerId: "provider-1",
    name: "Team model",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    modelId: "team-code",
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
    percent: 0,
    elapsedSeconds: 0,
    remainingSeconds: null,
    estimationState: "ready",
  },
  currentStepId: null,
  activeSince: null,
  pausedSince: null,
  pauseReason: null,
  createdAt: 100,
  updatedAt: 100,
} satisfies TaskSnapshot;

describe("TaskRepository routing metadata", () => {
  it("round-trips the immutable routing decision and execution fields", () => {
    const db = openDatabase(":memory:");
    const repository = new TaskRepository(db);
    repository.upsertProject({
      id: "project-1",
      name: "zoro-web-platform",
      canonicalPath: "/tmp/zoro-web-platform",
      lastOpenedAt: 100,
    });

    repository.create(routedTask);
    repository.saveSnapshot({ ...routedTask, updatedAt: 200 });

    expect(repository.get("task-1")).toMatchObject({
      routeDecision: {
        intent: "simple_code",
        lane: "light",
        executionMode: "read_only",
        confidence: "high",
        reasonCode: "code-explanation",
      },
      selectionMode: "auto",
      executionMode: "read_only",
      updatedAt: 200,
    });
    db.close();
  });

  it("rejects an attempt to change persisted routing metadata", () => {
    const db = openDatabase(":memory:");
    const repository = new TaskRepository(db);
    repository.upsertProject({
      id: "project-1",
      name: "zoro-web-platform",
      canonicalPath: "/tmp/zoro-web-platform",
      lastOpenedAt: 100,
    });
    repository.create(routedTask);

    expect(() =>
      repository.saveSnapshot({
        ...routedTask,
        routeDecision: {
          intent: "complex_code",
          lane: "premium",
          executionMode: "agentic",
          confidence: "medium",
          reasonCode: "ambiguous-premium-default",
        },
        selectionMode: "manual",
        executionMode: "agentic",
        updatedAt: 200,
      }),
    ).toThrow("routing metadata is immutable");
    expect(repository.get("task-1")).toMatchObject({
      routeDecision: { lane: "light" },
      selectionMode: "auto",
      executionMode: "read_only",
      updatedAt: 100,
    });
    db.close();
  });

  it("rejects an attempt to change the persisted provider snapshot", () => {
    const db = openDatabase(":memory:");
    const repository = new TaskRepository(db);
    repository.upsertProject({
      id: "project-1",
      name: "zoro-web-platform",
      canonicalPath: "/tmp/zoro-web-platform",
      lastOpenedAt: 100,
    });
    repository.create(routedTask);

    expect(() =>
      repository.saveSnapshot({
        ...routedTask,
        providerSnapshot: {
          providerId: "provider-2",
          name: "Replacement model",
          kind: "kimi",
          baseUrl: "https://api.moonshot.cn/v1",
          modelId: "kimi-k3",
          contextLength: 1_000_000,
        },
        updatedAt: 200,
      }),
    ).toThrow("provider snapshot is immutable");
    expect(repository.get("task-1")).toMatchObject({
      providerSnapshot: {
        providerId: "provider-1",
        name: "Team model",
        modelId: "team-code",
      },
      updatedAt: 100,
    });
    db.close();
  });
});
