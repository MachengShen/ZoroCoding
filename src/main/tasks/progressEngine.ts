import type { ProgressSnapshot, TaskStep } from "../../shared/domain";

export interface ProgressInput {
  now: number;
  startedAt: number;
  pausedAt: number | null;
  accumulatedPausedSeconds: number;
  steps: TaskStep[];
}

const ACTIVE_STEP_CAP = 0.85;
const SMOOTHING_ALPHA = 0.35;
const MIN_CORRECTION = 0.5;
const MAX_CORRECTION = 3;

function finiteEstimate(step: TaskStep): number {
  return Number.isFinite(step.estimateSeconds) && step.estimateSeconds > 0
    ? step.estimateSeconds
    : 0;
}

function correctionRatio(steps: TaskStep[]): number {
  return steps
    .filter(
      (step) =>
        step.status === "completed" &&
        step.actualSeconds !== null &&
        finiteEstimate(step) > 0,
    )
    .sort((left, right) => left.order - right.order)
    .reduce((smoothed, step) => {
      const observed = (step.actualSeconds ?? 0) / finiteEstimate(step);
      const next = smoothed + SMOOTHING_ALPHA * (observed - smoothed);
      return Math.min(MAX_CORRECTION, Math.max(MIN_CORRECTION, next));
    }, 1);
}

export function computeProgress(input: ProgressInput): ProgressSnapshot {
  const effectiveNow = input.pausedAt ?? input.now;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((effectiveNow - input.startedAt) / 1_000) -
      input.accumulatedPausedSeconds,
  );
  const totalEstimate = input.steps.reduce(
    (total, step) => total + finiteEstimate(step),
    0,
  );

  if (totalEstimate === 0) {
    return {
      percent: 0,
      elapsedSeconds,
      remainingSeconds: null,
      estimationState:
        input.pausedAt === null ? "recalculating" : "paused",
    };
  }

  let earnedEstimate = 0;
  let remainingEstimate = 0;

  for (const step of input.steps) {
    const estimate = finiteEstimate(step);
    if (step.status === "completed" || step.status === "skipped") {
      earnedEstimate += estimate;
      continue;
    }

    if (step.status === "running") {
      const observed = Math.min(
        ACTIVE_STEP_CAP,
        Math.max(0, step.observedFraction),
      );
      earnedEstimate += estimate * observed;
      remainingEstimate += estimate * (1 - observed);
      continue;
    }

    remainingEstimate += estimate;
  }

  const correction = correctionRatio(input.steps);

  return {
    percent: Math.min(
      100,
      Math.max(0, Math.round((earnedEstimate / totalEstimate) * 100)),
    ),
    elapsedSeconds,
    remainingSeconds: Math.round(remainingEstimate * correction),
    estimationState: input.pausedAt === null ? "ready" : "paused",
  };
}
