// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  advanceProgressClock,
  formatDuration,
  ProgressPanel,
  reconcileProgressClock,
} from "../../src/renderer/components/ProgressPanel";
import type { TaskDetail } from "../../src/shared/ipc";

function detailWithTerminalOutput(content: string, ok: boolean): TaskDetail {
  return {
    task: {
      id: "task-1",
      projectId: "project-1",
      title: "测试终端输出",
      prompt: "运行完整测试",
      status: ok ? "completed" : "failed",
      providerSnapshot: {
        providerId: "provider-1",
        name: "KIMI K3",
        kind: "kimi",
        baseUrl: "https://api.moonshot.cn/v1",
        modelId: "kimi-k3",
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
        percent: 100,
        elapsedSeconds: 12,
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
    project: {
      id: "project-1",
      name: "project",
      canonicalPath: "/tmp/project",
      lastOpenedAt: 1,
    },
    steps: [],
    messages: [],
    fileChanges: [],
    events: [
      {
        id: "event-1",
        taskId: "task-1",
        type: "tool_completed",
        at: 2,
        payload: {
          callId: "call-1",
          name: "run_shell",
          ok,
          content,
          denied: false,
          data: {},
        },
      },
    ],
  };
}

describe("ProgressPanel clock", () => {
  it("counts elapsed time up and remaining time down while active", () => {
    expect(
      advanceProgressClock(
        { elapsedSeconds: 10, remainingSeconds: 50 },
        "running",
        3,
      ),
    ).toEqual({
      elapsedSeconds: 13,
      remainingSeconds: 47,
    });
  });

  it("freezes both clocks while paused", () => {
    expect(
      advanceProgressClock(
        { elapsedSeconds: 10, remainingSeconds: 50 },
        "paused",
        3,
      ),
    ).toEqual({
      elapsedSeconds: 10,
      remainingSeconds: 50,
    });
    expect(formatDuration(65)).toBe("01:05");
  });

  it("does not reset a locally advanced clock when a frequent snapshot is stale", () => {
    expect(
      reconcileProgressClock(
        {
          taskId: "task-1",
          status: "running",
          percent: 20,
          elapsedSeconds: 11,
          remainingSeconds: 49,
        },
        {
          taskId: "task-1",
          status: "running",
          percent: 20,
          elapsedSeconds: 10,
          remainingSeconds: 50,
        },
      ),
    ).toEqual({
      taskId: "task-1",
      status: "running",
      percent: 20,
      elapsedSeconds: 11,
      remainingSeconds: 49,
    });
  });
});

describe("ProgressPanel terminal output", () => {
  it("does not present a denied read-only shell call as terminal execution", () => {
    const detail = detailWithTerminalOutput(
      "只读任务不允许运行终端命令。",
      false,
    );
    const denied = detail.events[0];
    if (denied?.type === "tool_completed") {
      denied.payload.denied = true;
    }

    render(
      <ProgressPanel
        detail={detail}
        drawerOpen
        onClose={() => {}}
        onResume={() => {}}
      />,
    );

    expect(screen.getByText("… 等待")).toBeVisible();
    expect(screen.getByLabelText("最近终端输出").textContent).toBe(
      "等待命令执行…",
    );
    expect(screen.queryByText("只读任务不允许运行终端命令。")).toBeNull();
  });

  it("shows the complete latest command output with its semantic status", () => {
    const content = `command: npm test\n${"x".repeat(260)}\n  exact tail  `;

    render(
      <ProgressPanel
        detail={detailWithTerminalOutput(content, false)}
        drawerOpen
        onClose={() => {}}
        onResume={() => {}}
      />,
    );

    expect(screen.getByText("✕ 错误")).toBeVisible();
    expect(screen.getByLabelText("最近终端输出").textContent).toBe(content);
  });

  it("shows waiting immediately for an active command with no output and ignores unrelated calls", () => {
    const detail = detailWithTerminalOutput("旧命令完整输出", true);
    detail.task.status = "running";
    detail.events.push(
      {
        id: "start-active",
        taskId: "task-1",
        type: "tool_started",
        at: 3,
        payload: {
          callId: "active",
          name: "run_shell",
          inputSummary: "npm test",
        },
      },
      {
        id: "other-output",
        taskId: "task-1",
        type: "tool_output",
        at: 4,
        payload: {
          callId: "unrelated",
          stream: "stdout",
          text: "不属于当前命令",
        },
      },
      {
        id: "other-completed",
        taskId: "task-1",
        type: "tool_completed",
        at: 5,
        payload: {
          callId: "unrelated",
          name: "run_shell",
          ok: true,
          content: "其他命令完成",
          denied: false,
          data: {},
        },
      },
    );

    render(
      <ProgressPanel
        detail={detail}
        drawerOpen
        onClose={() => {}}
        onResume={() => {}}
      />,
    );

    expect(screen.getByText("… 等待")).toBeVisible();
    expect(screen.getByLabelText("最近终端输出").textContent).toBe(
      "等待命令输出…",
    );
  });

  it("keeps active progress output explicitly bounded", () => {
    const detail = detailWithTerminalOutput("旧命令完整输出", true);
    detail.task.status = "running";
    detail.events.push(
      {
        id: "start-active",
        taskId: "task-1",
        type: "tool_started",
        at: 3,
        payload: {
          callId: "active",
          name: "run_shell",
          inputSummary: "npm test",
        },
      },
      {
        id: "active-output-1",
        taskId: "task-1",
        type: "tool_output",
        at: 4,
        payload: {
          callId: "active",
          stream: "stdout",
          text: `EARLY-${"a".repeat(20_000)}`,
        },
      },
      {
        id: "active-output-2",
        taskId: "task-1",
        type: "tool_output",
        at: 5,
        payload: {
          callId: "active",
          stream: "stdout",
          text: `TAIL-${"b".repeat(20_000)}`,
        },
      },
    );

    render(
      <ProgressPanel
        detail={detail}
        drawerOpen
        onClose={() => {}}
        onResume={() => {}}
      />,
    );

    const output =
      screen.getByLabelText("最近终端输出").textContent ?? "";
    expect(output.startsWith("[较早的实时输出已省略]\n")).toBe(true);
    expect(output).not.toContain("EARLY-");
    expect(output).toContain("TAIL-");
    expect(output.length).toBeLessThan(25_000);
  });
});
