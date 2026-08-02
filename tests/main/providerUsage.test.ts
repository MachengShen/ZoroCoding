import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/main/persistence/database";
import { TaskRepository } from "../../src/main/persistence/taskRepository";
import { isProviderReferencedByResumableTask } from "../../src/main/tasks/providerUsage";
import type { TaskSnapshot, TaskStatus } from "../../src/shared/domain";

function task(status: TaskStatus, id: string): TaskSnapshot {
  return {
    id,
    projectId: "project-1",
    title: id,
    prompt: "test",
    status,
    providerSnapshot: {
      providerId: "provider-1",
      name: "Original",
      kind: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      modelId: "original-model",
      contextLength: 128_000,
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
      percent: 0,
      elapsedSeconds: 0,
      remainingSeconds: null,
      estimationState: "recalculating",
    },
    currentStepId: null,
    activeSince: null,
    pausedSince: null,
    pauseReason: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("provider task references", () => {
  it("protects every resumable task status, including failed retries", () => {
    const database = openDatabase(":memory:");
    try {
      const repository = new TaskRepository(database);
      repository.upsertProject({
        id: "project-1",
        name: "Project",
        canonicalPath: "/tmp/project",
        lastOpenedAt: 1,
      });
      for (const [index, status] of [
        "planning",
        "running",
        "awaiting_approval",
        "paused",
        "failed",
      ].entries()) {
        repository.create(task(status as TaskStatus, `task-${index}`));
      }

      expect(
        isProviderReferencedByResumableTask(repository, "provider-1"),
      ).toBe(true);
      expect(
        isProviderReferencedByResumableTask(repository, "provider-2"),
      ).toBe(false);
    } finally {
      database.close();
    }
  });

  it.each(["draft", "completed", "canceled"] as const)(
    "does not protect non-resumable %s tasks",
    (status) => {
      const database = openDatabase(":memory:");
      try {
        const repository = new TaskRepository(database);
        repository.upsertProject({
          id: "project-1",
          name: "Project",
          canonicalPath: "/tmp/project",
          lastOpenedAt: 1,
        });
        repository.create(task(status, `task-${status}`));

        expect(
          isProviderReferencedByResumableTask(repository, "provider-1"),
        ).toBe(false);
      } finally {
        database.close();
      }
    },
  );
});
