import type { TaskEvent } from "../../shared/domain";

interface TerminalOutputProps {
  text: string;
  status?: "normal" | "error" | "waiting";
  label?: string;
}

const STATUS_LABELS: Record<
  NonNullable<TerminalOutputProps["status"]>,
  string
> = {
  normal: "✓ 完成",
  error: "✕ 错误",
  waiting: "… 等待",
};

const LIVE_TERMINAL_CHARACTER_LIMIT = 24_000;
const LIVE_TERMINAL_TRUNCATION_NOTICE =
  "[较早的实时输出已省略]\n";

export interface LiveTerminalOutput {
  active: boolean;
  text: string;
}

export function collectLiveTerminalOutput(
  events: readonly TaskEvent[],
): LiveTerminalOutput {
  const startIndex = events.findLastIndex(
    (event) =>
      event.type === "tool_started" &&
      event.payload.name === "run_shell",
  );
  const started =
    startIndex >= 0 && events[startIndex]?.type === "tool_started"
      ? events[startIndex]
      : null;
  if (started === null) {
    return { active: false, text: "" };
  }

  const callId = started.payload.callId;
  for (let index = startIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (
      event?.type === "tool_completed" &&
      event.payload.callId === callId
    ) {
      return { active: false, text: "" };
    }
  }

  const tailChunks: string[] = [];
  let remaining = LIVE_TERMINAL_CHARACTER_LIMIT;
  let truncated = false;
  for (let index = events.length - 1; index > startIndex; index -= 1) {
    const event = events[index];
    if (
      event?.type !== "tool_output" ||
      event.payload.callId !== callId ||
      event.payload.text.length === 0
    ) {
      continue;
    }
    if (remaining === 0) {
      truncated = true;
      break;
    }
    if (event.payload.text.length > remaining) {
      tailChunks.push(event.payload.text.slice(-remaining));
      remaining = 0;
      truncated = true;
      break;
    }
    tailChunks.push(event.payload.text);
    remaining -= event.payload.text.length;
  }

  let text = tailChunks.reverse().join("");
  const firstCodeUnit = text.charCodeAt(0);
  if (
    truncated &&
    firstCodeUnit >= 0xdc00 &&
    firstCodeUnit <= 0xdfff
  ) {
    text = text.slice(1);
  }
  const lastCodeUnit = text.charCodeAt(text.length - 1);
  if (
    lastCodeUnit >= 0xd800 &&
    lastCodeUnit <= 0xdbff
  ) {
    text = text.slice(0, -1);
  }
  return {
    active: true,
    text: truncated
      ? `${LIVE_TERMINAL_TRUNCATION_NOTICE}${text}`
      : text,
  };
}

export function TerminalOutput({
  text,
  status = "normal",
  label,
}: TerminalOutputProps) {
  return (
    <section
      className={`terminal-output-block terminal-output-${status}`}
    >
      <header className="terminal-output-header">
        <span className="terminal-status-label">
          {STATUS_LABELS[status]}
        </span>
        {label ? <span className="terminal-output-label">{label}</span> : null}
      </header>
      <pre className="terminal-output" aria-label={label ?? "终端输出"}>
        <code>{text}</code>
      </pre>
    </section>
  );
}
