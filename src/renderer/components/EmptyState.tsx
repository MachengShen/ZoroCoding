import { Code2, FolderOpen, PlusCircle } from "lucide-react";

interface EmptyStateProps {
  hasProjects: boolean;
  onNewTask(): void;
}

export function EmptyState({ hasProjects, onNewTask }: EmptyStateProps) {
  return (
    <section className="empty-state" aria-labelledby="empty-title">
      <span className="empty-icon" aria-hidden="true">
        {hasProjects ? <Code2 /> : <FolderOpen />}
      </span>
      <h1 id="empty-title">
        {hasProjects ? "开始一个编程任务" : "先选择本地项目"}
      </h1>
      <p>
        {hasProjects
          ? "描述要修改的内容，ZoroCoding 会规划步骤、修改代码并运行验证。"
          : "项目文件只在你的 Mac 上读取和修改，高风险操作会先询问。"}
      </p>
      <button className="primary-button" type="button" onClick={onNewTask}>
        <PlusCircle aria-hidden="true" />
        {hasProjects ? "发起新任务" : "授权本地项目"}
      </button>
    </section>
  );
}
