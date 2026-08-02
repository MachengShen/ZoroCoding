import type { TaskRepository } from "../persistence/taskRepository";

const RESUMABLE_TASK_STATUSES = new Set([
  "planning",
  "running",
  "awaiting_approval",
  "paused",
  "failed",
]);

export function isProviderReferencedByResumableTask(
  tasks: Pick<TaskRepository, "list">,
  providerId: string,
): boolean {
  return tasks.list().some(
    (task) =>
      task.providerSnapshot.providerId === providerId &&
      RESUMABLE_TASK_STATUSES.has(task.status),
  );
}
