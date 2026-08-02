import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  LoaderCircle,
  PauseCircle,
  PlayCircle,
  Terminal,
  X,
} from "lucide-react";

import type { StepStatus, TaskStatus } from "../../shared/domain";
import type { TaskDetail } from "../../shared/ipc";
import {
  collectLiveTerminalOutput,
  TerminalOutput,
} from "./TerminalOutput";

export function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "--:--";
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function advanceProgressClock(
  progress: {
    elapsedSeconds: number;
    remainingSeconds: number | null;
  },
  status: TaskStatus,
  seconds: number,
): {
  elapsedSeconds: number;
  remainingSeconds: number | null;
} {
  if (!["planning", "running"].includes(status)) {
    return progress;
  }
  return {
    elapsedSeconds: progress.elapsedSeconds + seconds,
    remainingSeconds:
      progress.remainingSeconds === null
        ? null
        : Math.max(0, progress.remainingSeconds - seconds),
  };
}

export interface ProgressClock {
  taskId: string;
  status: TaskStatus;
  percent: number;
  elapsedSeconds: number;
  remainingSeconds: number | null;
}

export function reconcileProgressClock(
  current: ProgressClock | null,
  incoming: ProgressClock,
): ProgressClock {
  if (
    current === null ||
    current.taskId !== incoming.taskId ||
    current.status !== incoming.status ||
    !["planning", "running"].includes(incoming.status)
  ) {
    return incoming;
  }
  const serverAdvanced =
    incoming.elapsedSeconds > current.elapsedSeconds;
  const estimateChanged = incoming.percent !== current.percent;
  return {
    ...incoming,
    elapsedSeconds: Math.max(
      current.elapsedSeconds,
      incoming.elapsedSeconds,
    ),
    remainingSeconds:
      serverAdvanced || estimateChanged
        ? incoming.remainingSeconds
        : current.remainingSeconds,
  };
}

function statusCopy(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    draft: "准备中",
    planning: "正在规划",
    running: "执行中",
    awaiting_approval: "等待批准",
    paused: "已暂停",
    completed: "已完成",
    failed: "执行失败",
    canceled: "已取消",
  };
  return labels[status];
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "completed") {
    return <CheckCircle2 aria-hidden="true" />;
  }
  if (status === "running") {
    return <LoaderCircle className="spin" aria-hidden="true" />;
  }
  if (status === "failed") {
    return <X aria-hidden="true" />;
  }
  return <Circle aria-hidden="true" />;
}

interface ProgressPanelProps {
  detail: TaskDetail | null;
  drawerOpen: boolean;
  onClose(): void;
  onResume(): void;
}

export function ProgressPanel({
  detail,
  drawerOpen,
  onClose,
  onResume,
}: ProgressPanelProps) {
  const [clock, setClock] = useState<ProgressClock | null>(null);
  const taskId = detail?.task.id;
  const taskStatus = detail?.task.status;
  const taskPercent = detail?.task.progress.percent;
  const taskElapsed = detail?.task.progress.elapsedSeconds;
  const taskRemaining = detail?.task.progress.remainingSeconds;
  useEffect(() => {
    if (
      taskId === undefined ||
      taskStatus === undefined ||
      taskPercent === undefined ||
      taskElapsed === undefined
    ) {
      setClock(null);
      return;
    }
    setClock((current) =>
      reconcileProgressClock(current, {
        taskId,
        status: taskStatus,
        percent: taskPercent,
        elapsedSeconds: taskElapsed,
        remainingSeconds: taskRemaining ?? null,
      }),
    );
  }, [
    taskElapsed,
    taskId,
    taskPercent,
    taskRemaining,
    taskStatus,
  ]);

  useEffect(() => {
    if (taskStatus !== "planning" && taskStatus !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      setClock((current) =>
        current === null
          ? null
          : {
              ...current,
              ...advanceProgressClock(current, current.status, 1),
            },
      );
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [taskId, taskStatus]);

  if (detail === null) {
    return (
      <aside
        className={drawerOpen ? "progress-panel drawer-open" : "progress-panel"}
        aria-label="任务进度"
      >
        <p className="progress-empty">发起任务后，这里会显示实时进度和预计剩余时间。</p>
      </aside>
    );
  }
  const { task, steps, events } = detail;
  const liveProgress =
    clock?.taskId === task.id ? clock : task.progress;
  const recentTerminal = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "tool_completed" &&
        event.payload.name === "run_shell" &&
        !event.payload.denied,
    );
  const liveTerminal = collectLiveTerminalOutput(events);

  return (
    <aside
      className={drawerOpen ? "progress-panel drawer-open" : "progress-panel"}
      aria-label="任务进度"
    >
      <header className="progress-header">
        <span>任务进度</span>
        <button
          className="icon-button drawer-close"
          type="button"
          aria-label="关闭任务进度"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </header>

      <div className={`progress-status status-${task.status}`}>
        {task.status === "paused" || task.status === "awaiting_approval" ? (
          <PauseCircle aria-hidden="true" />
        ) : (
          <LoaderCircle
            className={task.status === "running" ? "spin" : ""}
            aria-hidden="true"
          />
        )}
        <span>{statusCopy(task.status)}</span>
      </div>

      <section className="eta-block" aria-live="polite">
        <span>预计剩余</span>
        <strong>
          {task.progress.estimationState === "paused"
            ? "已暂停"
            : formatDuration(liveProgress.remainingSeconds)}
        </strong>
      </section>

      <div className="progress-meter-copy">
        <strong>{task.progress.percent}%</strong>
        <span>已用 {formatDuration(liveProgress.elapsedSeconds)}</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="任务完成进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={task.progress.percent}
      >
        <span style={{ width: `${task.progress.percent}%` }} />
      </div>

      {task.pauseReason === "interrupted" ? (
        <button className="primary-button recovery-action" type="button" onClick={onResume}>
          <PlayCircle aria-hidden="true" />
          安全继续
        </button>
      ) : null}

      <ol className="progress-steps">
        {steps.map((step) => (
          <li key={step.id} className={`step-${step.status}`}>
            <span className="step-icon">
              <StepIcon status={step.status} />
            </span>
            <span>
              <strong>{step.title}</strong>
              <small>
                {step.status === "completed"
                  ? "已完成"
                  : step.status === "running"
                    ? "正在执行"
                    : step.status === "failed"
                      ? "失败"
                      : "等待中"}
              </small>
            </span>
          </li>
        ))}
      </ol>

      <section className="recent-terminal">
        <div>
          <Terminal aria-hidden="true" />
          <span>终端输出</span>
        </div>
        <TerminalOutput
          text={
            liveTerminal.active
              ? liveTerminal.text || "等待命令输出…"
              : recentTerminal?.type === "tool_completed"
                ? recentTerminal.payload.content
                : "等待命令执行…"
          }
          status={
            liveTerminal.active ||
            recentTerminal?.type !== "tool_completed"
              ? "waiting"
              : recentTerminal.payload.ok
                ? "normal"
                : "error"
          }
          label="最近终端输出"
        />
      </section>
    </aside>
  );
}
