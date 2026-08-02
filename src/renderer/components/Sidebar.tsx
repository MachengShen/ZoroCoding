import {
  CheckCircle2,
  Circle,
  FolderOpen,
  LoaderCircle,
  MessageCircle,
  PauseCircle,
  PlusCircle,
  Settings,
} from "lucide-react";

import type {
  ProjectSummary,
  QuickChatSession,
  TaskStatus,
} from "../../shared/domain";
import type { TaskSummary } from "../../shared/ipc";
import type { AppView } from "../state/useZoroStore";

function statusText(status: TaskStatus, percent: number): string {
  switch (status) {
    case "running":
      return `执行中 · ${percent}%`;
    case "planning":
      return "正在规划";
    case "awaiting_approval":
      return "等待批准";
    case "paused":
      return "已暂停";
    case "completed":
      return "已完成";
    case "failed":
      return "执行失败";
    case "canceled":
      return "已取消";
    case "draft":
      return "准备中";
  }
}

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "completed") {
    return <CheckCircle2 aria-hidden="true" />;
  }
  if (status === "running" || status === "planning") {
    return <LoaderCircle className="spin" aria-hidden="true" />;
  }
  if (status === "paused" || status === "awaiting_approval") {
    return <PauseCircle aria-hidden="true" />;
  }
  return <Circle aria-hidden="true" />;
}

interface SidebarProps {
  projects: ProjectSummary[];
  tasks: TaskSummary[];
  activeTaskId: string | null;
  quickChatSessions: QuickChatSession[];
  activeQuickChatSessionId: string | null;
  view: AppView;
  newTaskDisabled?: boolean;
  onNewTask(): void;
  onSelectTask(taskId: string): void;
  onSelectQuickChatSession(sessionId: string): void;
  onViewChange(view: AppView): void;
}

export function Sidebar({
  projects,
  tasks,
  activeTaskId,
  quickChatSessions,
  activeQuickChatSessionId,
  view,
  newTaskDisabled = false,
  onNewTask,
  onSelectTask,
  onSelectQuickChatSession,
  onViewChange,
}: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="项目与任务">
      <div className="sidebar-drag-region" aria-hidden="true" />
      <div className="brand-row">
        <span className="brand-mark" aria-hidden="true">
          Z
        </span>
        <strong className="brand-name">ZoroCoding</strong>
      </div>

      <button
        className="new-task-button"
        type="button"
        disabled={newTaskDisabled}
        onClick={onNewTask}
      >
        <PlusCircle aria-hidden="true" />
        <span>发起新任务</span>
      </button>

      <button
        className={
          view === "quick_chat"
            ? "quick-chat-link selected"
            : "quick-chat-link"
        }
        type="button"
        onClick={() => onViewChange("quick_chat")}
      >
        <MessageCircle aria-hidden="true" />
        <span>快速问答</span>
      </button>

      {quickChatSessions.length > 0 ? (
        <nav className="quick-chat-history" aria-label="快速问答历史">
          <span className="sidebar-label">问答记录</span>
          {quickChatSessions.map((session) => (
            <button
              key={session.id}
              className={
                view === "quick_chat" &&
                activeQuickChatSessionId === session.id
                  ? "quick-chat-session-row selected"
                  : "quick-chat-session-row"
              }
              type="button"
              onClick={() => {
                onViewChange("quick_chat");
                onSelectQuickChatSession(session.id);
              }}
            >
              {session.title}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="sidebar-section">
        <span className="sidebar-label">当前项目</span>
        <div className="project-row">
          <FolderOpen aria-hidden="true" />
          <span>{projects[0]?.name ?? "尚未选择项目"}</span>
        </div>
      </div>

      <nav className="task-history" aria-label="任务历史">
        <span className="sidebar-label">最近任务</span>
        {tasks.length === 0 ? (
          <p className="sidebar-empty">还没有任务</p>
        ) : (
          tasks.map((task) => (
            <button
              key={task.id}
              className={
                activeTaskId === task.id && view === "workbench"
                  ? "task-row selected"
                  : "task-row"
              }
              type="button"
              onClick={() => {
                onViewChange("workbench");
                onSelectTask(task.id);
              }}
            >
              <StatusIcon status={task.status} />
              <span className="task-row-copy">
                <strong>{task.title}</strong>
                <small>{statusText(task.status, task.progress.percent)}</small>
              </span>
            </button>
          ))
        )}
      </nav>

      <button
        className={view === "settings" ? "settings-link selected" : "settings-link"}
        type="button"
        onClick={() => onViewChange("settings")}
      >
        <Settings aria-hidden="true" />
        <span>设置与模型</span>
      </button>
    </aside>
  );
}
