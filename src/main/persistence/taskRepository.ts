import { randomUUID } from "node:crypto";

import {
  taskEventSchema,
  taskSnapshotSchema,
  taskStepSchema,
  type ProjectSummary,
  type TaskEvent,
  type TaskSnapshot,
  type TaskStep,
} from "../../shared/domain";
import type { ModelMessage } from "../models/types";
import { reduceTask } from "../tasks/taskReducer";
import type { ZoroDatabase } from "./database";
import { allowWrites, type LiveWriteGate } from "./liveWriteGate";

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  prompt: string;
  status: TaskSnapshot["status"];
  provider_snapshot_json: string;
  route_decision_json: string;
  selection_mode: TaskSnapshot["selectionMode"];
  execution_mode: TaskSnapshot["executionMode"];
  progress_json: string;
  current_step_id: string | null;
  active_since: number | null;
  paused_since: number | null;
  pause_reason: TaskSnapshot["pauseReason"];
  created_at: number;
  updated_at: number;
}

interface RoutingMetadataRow {
  provider_snapshot_json: string;
  route_decision_json: string;
  selection_mode: TaskSnapshot["selectionMode"];
  execution_mode: TaskSnapshot["executionMode"];
}

interface EventRow {
  id: string;
  task_id: string;
  event_type: TaskEvent["type"];
  at: number;
  payload_json: string;
}

interface ProjectRow {
  id: string;
  name: string;
  canonical_path: string;
  last_opened_at: number;
}

interface MessageRow {
  id: string;
  task_id: string;
  role: string;
  content: string;
  created_at: number;
}

interface FileChangeRow {
  id: string;
  task_id: string;
  canonical_path: string;
  before_hash: string;
  after_hash: string;
  patch: string;
  created_at: number;
}

export interface PersistedMessage {
  id: string;
  taskId: string;
  message: ModelMessage;
  createdAt: number;
}

export interface PersistedFileChange {
  id: string;
  taskId: string;
  canonicalPath: string;
  beforeHash: string;
  afterHash: string;
  patch: string;
  createdAt: number;
}

function hydrateTask(row: TaskRow): TaskSnapshot {
  return taskSnapshotSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    prompt: row.prompt,
    status: row.status,
    providerSnapshot: JSON.parse(row.provider_snapshot_json) as unknown,
    routeDecision: JSON.parse(row.route_decision_json) as unknown,
    selectionMode: row.selection_mode,
    executionMode: row.execution_mode,
    progress: JSON.parse(row.progress_json) as unknown,
    currentStepId: row.current_step_id,
    activeSince: row.active_since,
    pausedSince: row.paused_since,
    pauseReason: row.pause_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) as TaskSnapshot;
}

export class TaskRepository {
  constructor(private readonly database: ZoroDatabase, private readonly writeGate: LiveWriteGate = allowWrites) {}

  upsertProject(project: ProjectSummary): void {
    this.writeGate.assertWritable();
    this.database
      .prepare(
        `INSERT INTO projects(id, name, canonical_path, last_opened_at)
         VALUES (@id, @name, @canonicalPath, @lastOpenedAt)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           canonical_path = excluded.canonical_path,
           last_opened_at = excluded.last_opened_at`,
      )
      .run(project);
  }

  getProject(projectId: string): ProjectSummary | null {
    const row = this.database
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(projectId) as ProjectRow | undefined;
    return row === undefined
      ? null
      : {
          id: row.id,
          name: row.name,
          canonicalPath: row.canonical_path,
          lastOpenedAt: row.last_opened_at,
        };
  }

  listProjects(): ProjectSummary[] {
    const rows = this.database
      .prepare("SELECT * FROM projects ORDER BY last_opened_at DESC")
      .all() as ProjectRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      canonicalPath: row.canonical_path,
      lastOpenedAt: row.last_opened_at,
    }));
  }

  create(snapshot: TaskSnapshot): void {
    this.writeGate.assertWritable();
    const parsed = taskSnapshotSchema.parse(snapshot) as TaskSnapshot;
    this.database
      .prepare(
        `INSERT INTO tasks(
          id, project_id, title, prompt, status, provider_snapshot_json,
          route_decision_json, selection_mode, execution_mode,
          progress_json, current_step_id, active_since, paused_since,
          pause_reason, created_at, updated_at
        ) VALUES (
          @id, @projectId, @title, @prompt, @status, @providerSnapshotJson,
          @routeDecisionJson, @selectionMode, @executionMode,
          @progressJson, @currentStepId, @activeSince, @pausedSince,
          @pauseReason, @createdAt, @updatedAt
        )`,
      )
      .run({
        ...parsed,
        providerSnapshotJson: JSON.stringify(parsed.providerSnapshot),
        routeDecisionJson: JSON.stringify(parsed.routeDecision),
        progressJson: JSON.stringify(parsed.progress),
      });
  }

  get(taskId: string): TaskSnapshot | null {
    const row = this.database
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(taskId) as TaskRow | undefined;
    return row === undefined ? null : hydrateTask(row);
  }

  list(projectId?: string): TaskSnapshot[] {
    const rows =
      projectId === undefined
        ? (this.database
            .prepare("SELECT * FROM tasks ORDER BY updated_at DESC")
            .all() as TaskRow[])
        : (this.database
            .prepare(
              "SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC",
            )
            .all(projectId) as TaskRow[]);
    return rows.map(hydrateTask);
  }

  saveSnapshot(snapshot: TaskSnapshot): void {
    this.writeGate.assertWritable();
    this.updateSnapshot(snapshot);
  }

  appendEvent(event: TaskEvent): TaskSnapshot {
    this.writeGate.assertWritable();
    return this.database.transaction(() => {
      const parsedEvent = taskEventSchema.parse(event) as TaskEvent;
      const current = this.get(parsedEvent.taskId);
      if (current === null) {
        throw new Error(`Task ${parsedEvent.taskId} does not exist`);
      }
      const next = reduceTask(current, parsedEvent);

      this.database
        .prepare(
          `INSERT INTO task_events(id, task_id, event_type, at, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          parsedEvent.id,
          parsedEvent.taskId,
          parsedEvent.type,
          parsedEvent.at,
          JSON.stringify(parsedEvent.payload),
        );
      this.updateSnapshot(next);
      return next;
    })();
  }

  events(taskId: string): TaskEvent[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM task_events WHERE task_id = ? ORDER BY at ASC, rowid ASC",
      )
      .all(taskId) as EventRow[];
    return rows.map(
      (row) =>
        taskEventSchema.parse({
          id: row.id,
          taskId: row.task_id,
          type: row.event_type,
          at: row.at,
          payload: JSON.parse(row.payload_json) as unknown,
        }) as TaskEvent,
    );
  }

  replaceSteps(taskId: string, steps: TaskStep[]): void {
    this.writeGate.assertWritable();
    this.database.transaction(() => {
      this.database
        .prepare("DELETE FROM task_steps WHERE task_id = ?")
        .run(taskId);
      const insert = this.database.prepare(
        `INSERT INTO task_steps(id, task_id, step_order, data_json)
         VALUES (?, ?, ?, ?)`,
      );
      for (const step of steps) {
        const parsed = taskStepSchema.parse(step) as TaskStep;
        if (parsed.taskId !== taskId) {
          throw new Error(`Step ${parsed.id} belongs to another task`);
        }
        insert.run(
          parsed.id,
          parsed.taskId,
          parsed.order,
          JSON.stringify(parsed),
        );
      }
    })();
  }

  steps(taskId: string): TaskStep[] {
    const rows = this.database
      .prepare(
        `SELECT data_json FROM task_steps
         WHERE task_id = ? ORDER BY step_order ASC`,
      )
      .all(taskId) as Array<{ data_json: string }>;
    return rows.map(
      (row) =>
        taskStepSchema.parse(
          JSON.parse(row.data_json) as unknown,
        ) as TaskStep,
    );
  }

  updateStep(step: TaskStep): void {
    this.writeGate.assertWritable();
    const parsed = taskStepSchema.parse(step) as TaskStep;
    const result = this.database
      .prepare(
        `UPDATE task_steps
         SET step_order = ?, data_json = ?
         WHERE id = ? AND task_id = ?`,
      )
      .run(
        parsed.order,
        JSON.stringify(parsed),
        parsed.id,
        parsed.taskId,
      );
    if (result.changes !== 1) {
      throw new Error(`Step ${parsed.id} does not exist`);
    }
  }

  appendMessage(
    taskId: string,
    message: ModelMessage,
    createdAt: number,
    id: string = randomUUID(),
  ): PersistedMessage {
    this.writeGate.assertWritable();
    this.database
      .prepare(
        `INSERT INTO messages(id, task_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, taskId, message.role, JSON.stringify(message), createdAt);
    return { id, taskId, message, createdAt };
  }

  messages(taskId: string): PersistedMessage[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM messages
         WHERE task_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(taskId) as MessageRow[];
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      message: JSON.parse(row.content) as ModelMessage,
      createdAt: row.created_at,
    }));
  }

  appendFileChange(
    change: Omit<PersistedFileChange, "id"> & { id?: string },
  ): PersistedFileChange {
    this.writeGate.assertWritable();
    const complete = {
      ...change,
      id: change.id ?? randomUUID(),
    };
    this.database
      .prepare(
        `INSERT INTO file_changes(
          id, task_id, canonical_path, before_hash, after_hash, patch,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        complete.id,
        complete.taskId,
        complete.canonicalPath,
        complete.beforeHash,
        complete.afterHash,
        complete.patch,
        complete.createdAt,
      );
    return complete;
  }

  fileChanges(taskId: string): PersistedFileChange[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM file_changes
         WHERE task_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(taskId) as FileChangeRow[];
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      canonicalPath: row.canonical_path,
      beforeHash: row.before_hash,
      afterHash: row.after_hash,
      patch: row.patch,
      createdAt: row.created_at,
    }));
  }

  recoverInterrupted(now: number): TaskSnapshot[] {
    const interrupted = this.database
      .prepare(
        `SELECT * FROM tasks
         WHERE status IN ('planning', 'running', 'awaiting_approval')`,
      )
      .all() as TaskRow[];

    return interrupted.map((row) =>
      this.appendEvent({
        id: randomUUID(),
        taskId: row.id,
        type: "app_interrupted",
        at: now,
        payload: {},
      }),
    );
  }

  private updateSnapshot(snapshot: TaskSnapshot): void {
    const parsed = taskSnapshotSchema.parse(snapshot) as TaskSnapshot;
    this.assertRoutingMetadataUnchanged(parsed);
    this.database
      .prepare(
        `UPDATE tasks SET
          status = @status,
          progress_json = @progressJson,
          current_step_id = @currentStepId,
          active_since = @activeSince,
          paused_since = @pausedSince,
          pause_reason = @pauseReason,
          updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        ...parsed,
        progressJson: JSON.stringify(parsed.progress),
      });
  }

  private assertRoutingMetadataUnchanged(snapshot: TaskSnapshot): void {
    const persisted = this.database
      .prepare(
        `SELECT provider_snapshot_json, route_decision_json, selection_mode, execution_mode
         FROM tasks WHERE id = ?`,
      )
      .get(snapshot.id) as RoutingMetadataRow | undefined;
    if (persisted === undefined) {
      return;
    }
    const providerSnapshot = JSON.parse(
      persisted.provider_snapshot_json,
    ) as TaskSnapshot["providerSnapshot"];
    const routeDecision = JSON.parse(
      persisted.route_decision_json,
    ) as TaskSnapshot["routeDecision"];
    const sameProvider =
      providerSnapshot.providerId === snapshot.providerSnapshot.providerId &&
      providerSnapshot.name === snapshot.providerSnapshot.name &&
      providerSnapshot.kind === snapshot.providerSnapshot.kind &&
      providerSnapshot.baseUrl === snapshot.providerSnapshot.baseUrl &&
      providerSnapshot.modelId === snapshot.providerSnapshot.modelId &&
      providerSnapshot.contextLength === snapshot.providerSnapshot.contextLength;
    const sameRoute =
      routeDecision.intent === snapshot.routeDecision.intent &&
      routeDecision.lane === snapshot.routeDecision.lane &&
      routeDecision.executionMode === snapshot.routeDecision.executionMode &&
      routeDecision.confidence === snapshot.routeDecision.confidence &&
      routeDecision.reasonCode === snapshot.routeDecision.reasonCode;
    if (!sameProvider) {
      throw new Error(`Task ${snapshot.id} provider snapshot is immutable`);
    }
    if (
      !sameRoute ||
      persisted.selection_mode !== snapshot.selectionMode ||
      persisted.execution_mode !== snapshot.executionMode
    ) {
      throw new Error(`Task ${snapshot.id} routing metadata is immutable`);
    }
  }
}
