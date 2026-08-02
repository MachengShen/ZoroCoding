// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodePatch } from "../../src/renderer/components/CodePatch";
import {
  collectLiveTerminalOutput,
  TerminalOutput,
} from "../../src/renderer/components/TerminalOutput";
import { Workbench } from "../../src/renderer/components/Workbench";
import type { TaskDetail } from "../../src/shared/ipc";

function runningDetail(events: TaskDetail["events"]): TaskDetail {
  return {
    task: {
      id: "task-1",
      projectId: "project-1",
      title: "实时终端测试",
      prompt: "运行测试",
      status: "running",
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
        percent: 50,
        elapsedSeconds: 10,
        remainingSeconds: 10,
        estimationState: "ready",
      },
      currentStepId: null,
      activeSince: 1,
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
    events,
    messages: [],
    fileChanges: [],
  };
}

function containsLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("CodePatch", () => {
  it("classifies diff metadata, additions, removals, and context without changing the patch", () => {
    const patch = [
      "diff --cc src/example.ts",
      "copy from src/old.ts",
      "copy to src/example.ts",
      "dissimilarity index 25%",
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@@ -1,3 -1,3 +1,4 @@@",
      " unchanged",
      "-const answer = 41;",
      "+const answer = 42;",
      "",
      "+export { answer };",
      "\\ No newline at end of file",
    ].join("\n") + "\n";

    const { container } = render(<CodePatch patch={patch} />);

    const output = screen.getByLabelText("代码变更");
    expect(output.textContent).toBe(patch);
    expect(
      Array.from(container.querySelectorAll(".diff-meta"), (line) =>
        line.textContent,
      ),
    ).toEqual([
      "diff --cc src/example.ts",
      "copy from src/old.ts",
      "copy to src/example.ts",
      "dissimilarity index 25%",
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@@ -1,3 -1,3 +1,4 @@@",
      "\\ No newline at end of file",
    ]);
    expect(
      Array.from(container.querySelectorAll(".diff-add"), (line) =>
        line.textContent,
      ),
    ).toEqual(["+const answer = 42;", "+export { answer };"]);
    expect(
      Array.from(container.querySelectorAll(".diff-remove"), (line) =>
        line.textContent,
      ),
    ).toEqual(["-const answer = 41;"]);
    expect(
      Array.from(container.querySelectorAll(".diff-context"), (line) =>
        line.textContent,
      ),
    ).toEqual([" unchanged", "", ""]);
    expect(output.textContent).toContain("\n\n+export { answer };");
    expect(output.textContent?.endsWith("\n")).toBe(true);
  });

  it("classifies combined diff and combined mode headers as metadata", () => {
    const patch = [
      "diff --combined src/example.ts",
      "mode 100644,100644..100755",
      "@@@ -1,1 -1,1 +1,1 @@@",
      "+updated",
    ].join("\n") + "\n";

    const { container } = render(<CodePatch patch={patch} />);

    expect(screen.getByLabelText("代码变更").textContent).toBe(patch);
    expect(
      Array.from(container.querySelectorAll(".diff-meta"), (line) =>
        line.textContent,
      ),
    ).toEqual([
      "diff --combined src/example.ts",
      "mode 100644,100644..100755",
      "@@@ -1,1 -1,1 +1,1 @@@",
    ]);
  });
});

describe("Workbench live terminal output", () => {
  it("does not render a terminal execution record for a denied read-only shell call", () => {
    const detail = runningDetail([
      {
        id: "denied-start",
        taskId: "task-1",
        type: "tool_started",
        at: 1,
        payload: {
          callId: "denied-shell",
          name: "run_shell",
          inputSummary: "run_shell",
        },
      },
      {
        id: "denied-complete",
        taskId: "task-1",
        type: "tool_completed",
        at: 2,
        payload: {
          callId: "denied-shell",
          name: "run_shell",
          ok: false,
          denied: true,
          content: "只读任务不允许运行终端命令。",
          data: {},
        },
      },
    ]);

    const { container } = render(
      <Workbench
        detail={detail}
        hasProjects
        onNewTask={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onRetry={() => {}}
        onAddMessage={async () => {}}
        onCancel={() => {}}
        onOpenProgress={() => {}}
      />,
    );

    expect(container.querySelectorAll(".activity-details")).toHaveLength(0);
    expect(screen.queryByText("终端输出", { exact: true })).toBeNull();
    expect(screen.queryByLabelText("命令返回错误")).toBeNull();
  });

  it("renders only an explicit bounded tail for a large active command", () => {
    const detail = runningDetail([
      {
        id: "start-active",
        taskId: "task-1",
        type: "tool_started",
        at: 1,
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
        at: 2,
        payload: {
          callId: "active",
          stream: "stdout",
          text: `EARLY-${"a".repeat(20_000)}`,
        },
      },
      {
        id: "other-output",
        taskId: "task-1",
        type: "tool_output",
        at: 3,
        payload: {
          callId: "unrelated",
          stream: "stdout",
          text: `UNRELATED-${"z".repeat(20_000)}`,
        },
      },
      {
        id: "active-output-2",
        taskId: "task-1",
        type: "tool_output",
        at: 4,
        payload: {
          callId: "active",
          stream: "stdout",
          text: `TAIL-${"b".repeat(20_000)}`,
        },
      },
    ]);

    render(
      <Workbench
        detail={detail}
        hasProjects
        onNewTask={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onRetry={() => {}}
        onAddMessage={async () => {}}
        onCancel={() => {}}
        onOpenProgress={() => {}}
      />,
    );

    const output = screen.getByLabelText("实时输出").textContent ?? "";
    expect(output.startsWith("[较早的实时输出已省略]\n")).toBe(true);
    expect(output).not.toContain("EARLY-");
    expect(output).not.toContain("UNRELATED-");
    expect(output).toContain("TAIL-");
    expect(output.length).toBeLessThan(25_000);
  });

  it("never splits Unicode surrogate pairs at the bounded-tail boundary", () => {
    const singleChunk = collectLiveTerminalOutput(
      runningDetail([
        {
          id: "start-single",
          taskId: "task-1",
          type: "tool_started",
          at: 1,
          payload: {
            callId: "single",
            name: "run_shell",
            inputSummary: "unicode",
          },
        },
        {
          id: "output-single",
          taskId: "task-1",
          type: "tool_output",
          at: 2,
          payload: {
            callId: "single",
            stream: "stdout",
            text: `${"😀".repeat(12_000)}x`,
          },
        },
      ]).events,
    );
    const splitAcrossChunks = collectLiveTerminalOutput(
      runningDetail([
        {
          id: "start-split",
          taskId: "task-1",
          type: "tool_started",
          at: 1,
          payload: {
            callId: "split",
            name: "run_shell",
            inputSummary: "unicode",
          },
        },
        {
          id: "output-high",
          taskId: "task-1",
          type: "tool_output",
          at: 2,
          payload: {
            callId: "split",
            stream: "stdout",
            text: `early\uD83D`,
          },
        },
        {
          id: "output-low",
          taskId: "task-1",
          type: "tool_output",
          at: 3,
          payload: {
            callId: "split",
            stream: "stdout",
            text: `\uDE00${"x".repeat(23_999)}`,
          },
        },
      ]).events,
    );

    for (const output of [singleChunk.text, splitAcrossChunks.text]) {
      expect(output.startsWith("[较早的实时输出已省略]\n")).toBe(true);
      expect(containsLoneSurrogate(output)).toBe(false);
      expect(output.length).toBeLessThanOrEqual(
        "[较早的实时输出已省略]\n".length + 24_000,
      );
    }
    expect(singleChunk.text.endsWith("😀".repeat(11_999) + "x")).toBe(true);
    expect(splitAcrossChunks.text.endsWith("x".repeat(23_999))).toBe(true);

    render(
      <TerminalOutput
        text={splitAcrossChunks.text}
        status="waiting"
        label="Unicode 实时输出"
      />,
    );
    const copyableText =
      screen.getByLabelText("Unicode 实时输出").textContent ?? "";
    expect(copyableText).toBe(splitAcrossChunks.text);
    expect(containsLoneSurrogate(copyableText)).toBe(false);
  });

  it("withholds a trailing high surrogate until its low surrogate arrives", () => {
    const untruncatedEvents: TaskDetail["events"] = [
      {
        id: "start-untruncated",
        taskId: "task-1",
        type: "tool_started",
        at: 1,
        payload: {
          callId: "untruncated",
          name: "run_shell",
          inputSummary: "unicode",
        },
      },
      {
        id: "output-high",
        taskId: "task-1",
        type: "tool_output",
        at: 2,
        payload: {
          callId: "untruncated",
          stream: "stdout",
          text: "ready:\uD83D",
        },
      },
    ];
    const pending = collectLiveTerminalOutput(untruncatedEvents);
    const restored = collectLiveTerminalOutput([
      ...untruncatedEvents,
      {
        id: "output-low",
        taskId: "task-1",
        type: "tool_output",
        at: 3,
        payload: {
          callId: "untruncated",
          stream: "stdout",
          text: "\uDE00",
        },
      },
    ]);

    expect(pending.text).toBe("ready:");
    expect(containsLoneSurrogate(pending.text)).toBe(false);
    expect(restored.text).toBe("ready:😀");
    expect(containsLoneSurrogate(restored.text)).toBe(false);

    const { rerender } = render(
      <TerminalOutput
        text={pending.text}
        status="waiting"
        label="分块 Unicode 输出"
      />,
    );
    expect(screen.getByLabelText("分块 Unicode 输出").textContent).toBe(
      "ready:",
    );
    rerender(
      <TerminalOutput
        text={restored.text}
        status="waiting"
        label="分块 Unicode 输出"
      />,
    );
    expect(screen.getByLabelText("分块 Unicode 输出").textContent).toBe(
      "ready:😀",
    );
  });

  it("withholds and restores a trailing surrogate on the bounded path", () => {
    const notice = "[较早的实时输出已省略]\n";
    const truncatedEvents: TaskDetail["events"] = [
      {
        id: "start-truncated",
        taskId: "task-1",
        type: "tool_started",
        at: 1,
        payload: {
          callId: "truncated",
          name: "run_shell",
          inputSummary: "unicode",
        },
      },
      {
        id: "output-high",
        taskId: "task-1",
        type: "tool_output",
        at: 2,
        payload: {
          callId: "truncated",
          stream: "stdout",
          text: `early-${"x".repeat(24_000)}\uD83D`,
        },
      },
    ];
    const pending = collectLiveTerminalOutput(truncatedEvents);
    const restored = collectLiveTerminalOutput([
      ...truncatedEvents,
      {
        id: "output-low",
        taskId: "task-1",
        type: "tool_output",
        at: 3,
        payload: {
          callId: "truncated",
          stream: "stdout",
          text: "\uDE00",
        },
      },
    ]);

    for (const output of [pending.text, restored.text]) {
      expect(output.startsWith(notice)).toBe(true);
      expect(containsLoneSurrogate(output)).toBe(false);
      expect(output.slice(notice.length).length).toBeLessThanOrEqual(24_000);
    }
    expect(pending.text.endsWith("x")).toBe(true);
    expect(restored.text.endsWith("😀")).toBe(true);
  });
});

describe("TerminalOutput", () => {
  it("preserves exact whitespace and the full returned command text", () => {
    const text = "npm test\n  indented result\n\nfinal line  ";

    render(<TerminalOutput text={text} label="npm test -- --runInBand" />);

    expect(screen.getByLabelText("npm test -- --runInBand").textContent).toBe(
      text,
    );
    expect(screen.getByText("✓ 完成")).toBeVisible();
  });

  it("renders semantic error and waiting labels", () => {
    const { rerender } = render(
      <TerminalOutput text={"failure\n"} status="error" />,
    );

    expect(screen.getByText("✕ 错误")).toBeVisible();
    expect(screen.getByLabelText("终端输出").textContent).toBe("failure\n");

    rerender(<TerminalOutput text="still running…" status="waiting" />);

    expect(screen.getByText("… 等待")).toBeVisible();
    expect(screen.getByLabelText("终端输出").textContent).toBe(
      "still running…",
    );
  });
});
