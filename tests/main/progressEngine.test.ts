import { describe, expect, it } from "vitest";

import { computeProgress } from "../../src/main/tasks/progressEngine";
import type { TaskStep } from "../../src/shared/domain";

function step(overrides: Partial<TaskStep>): TaskStep {
  return {
    id: "step",
    taskId: "task-1",
    order: 0,
    title: "步骤",
    completionCriteria: "完成",
    estimateSeconds: 60,
    actualSeconds: null,
    observedFraction: 0,
    status: "pending",
    ...overrides,
  };
}

describe("computeProgress", () => {
  it("uses completed weights and caps an active step at 85 percent", () => {
    const result = computeProgress({
      now: 25_000,
      startedAt: 0,
      pausedAt: null,
      accumulatedPausedSeconds: 0,
      steps: [
        step({
          id: "inspect",
          estimateSeconds: 20,
          actualSeconds: 20,
          observedFraction: 1,
          status: "completed",
        }),
        step({
          id: "implement",
          order: 1,
          estimateSeconds: 80,
          observedFraction: 1,
          status: "running",
        }),
      ],
    });

    expect(result.percent).toBe(88);
    expect(result.elapsedSeconds).toBe(25);
    expect(result.remainingSeconds).toBe(12);
    expect(result.estimationState).toBe("ready");
  });

  it("uses a smoothed correction ratio from completed work", () => {
    const result = computeProgress({
      now: 100_000,
      startedAt: 0,
      pausedAt: null,
      accumulatedPausedSeconds: 0,
      steps: [
        step({
          id: "slow",
          estimateSeconds: 20,
          actualSeconds: 40,
          observedFraction: 1,
          status: "completed",
        }),
        step({
          id: "pending",
          order: 1,
          estimateSeconds: 100,
        }),
      ],
    });

    expect(result.percent).toBe(17);
    expect(result.remainingSeconds).toBe(135);
  });

  it("pauses elapsed time and ETA state while awaiting input", () => {
    const result = computeProgress({
      now: 120_000,
      startedAt: 0,
      pausedAt: 90_000,
      accumulatedPausedSeconds: 10,
      steps: [step({ status: "running", observedFraction: 0.5 })],
    });

    expect(result.elapsedSeconds).toBe(80);
    expect(result.estimationState).toBe("paused");
  });

  it("reports recalculation when no finite estimate exists", () => {
    const result = computeProgress({
      now: 1_000,
      startedAt: 0,
      pausedAt: null,
      accumulatedPausedSeconds: 0,
      steps: [],
    });

    expect(result).toEqual({
      percent: 0,
      elapsedSeconds: 1,
      remainingSeconds: null,
      estimationState: "recalculating",
    });
  });
});
