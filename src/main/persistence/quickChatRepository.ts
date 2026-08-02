import {
  quickChatAssistantMessageUpdateSchema,
  quickChatMessageSchema,
  quickChatSessionSchema,
  type QuickChatAssistantMessageUpdate,
  type QuickChatMessage,
  type QuickChatSession,
} from "../../shared/domain";
import { z } from "zod";
import type { ZoroDatabase } from "./database";
import { allowWrites, type LiveWriteGate } from "./liveWriteGate";

interface QuickChatSessionRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface QuickChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  provider_snapshot_json: string | null;
  route_decision_json: string | null;
  status: string;
  error_message: string | null;
  created_at: number;
}

const persistedJsonSchema = z
  .string()
  .transform((serialized, context) => {
    try {
      return JSON.parse(serialized) as unknown;
    } catch {
      context.addIssue({
        code: "custom",
        message: "Malformed persisted Quick Chat JSON",
      });
      return z.NEVER;
    }
  })
  .nullable();

function hydrateSession(row: QuickChatSessionRow): QuickChatSession {
  return quickChatSessionSchema.parse({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) as QuickChatSession;
}

function hydrateMessage(row: QuickChatMessageRow): QuickChatMessage {
  return quickChatMessageSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    providerSnapshot: persistedJsonSchema.parse(row.provider_snapshot_json),
    routeDecision: persistedJsonSchema.parse(row.route_decision_json),
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  }) as QuickChatMessage;
}

export class QuickChatRepository {
  constructor(
    private readonly database: ZoroDatabase,
    private readonly writeGate: LiveWriteGate = allowWrites,
  ) {}

  createSession(session: QuickChatSession): void {
    this.writeGate.assertWritable();
    const parsed = quickChatSessionSchema.parse(session) as QuickChatSession;
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO quick_chat_sessions(id, title, created_at, updated_at)
           VALUES (@id, @title, @createdAt, @updatedAt)`,
        )
        .run(parsed);
    })();
  }

  renameSession(id: string, title: string, updatedAt: number): void {
    this.writeGate.assertWritable();
    const parsed = quickChatSessionSchema.pick({ title: true, updatedAt: true }).parse({
      title,
      updatedAt,
    });
    this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE quick_chat_sessions
           SET title = @title, updated_at = @updatedAt
           WHERE id = @id`,
        )
        .run({ id, ...parsed });
      if (result.changes !== 1) {
        throw new Error(`Session ${id} does not exist`);
      }
    })();
  }

  deleteSession(id: string): void {
    this.writeGate.assertWritable();
    this.database.transaction(() => {
      const result = this.database
        .prepare("DELETE FROM quick_chat_sessions WHERE id = ?")
        .run(id);
      if (result.changes !== 1) {
        throw new Error(`Session ${id} does not exist`);
      }
    })();
  }

  listSessions(): QuickChatSession[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM quick_chat_sessions
         ORDER BY updated_at DESC, created_at ASC, id ASC`,
      )
      .all() as QuickChatSessionRow[];
    return rows.map(hydrateSession);
  }

  getSession(id: string): QuickChatSession | null {
    const row = this.database
      .prepare("SELECT * FROM quick_chat_sessions WHERE id = ?")
      .get(id) as QuickChatSessionRow | undefined;
    return row === undefined ? null : hydrateSession(row);
  }

  insertMessage(message: QuickChatMessage): void {
    this.writeGate.assertWritable();
    const parsed = quickChatMessageSchema.parse(message) as QuickChatMessage;
    this.database.transaction(() => {
      this.assertSessionExists(parsed.sessionId);
      this.database
        .prepare(
          `INSERT INTO quick_chat_messages(
            id, session_id, role, content, provider_snapshot_json,
            route_decision_json, status, error_message, created_at
          ) VALUES (
            @id, @sessionId, @role, @content, @providerSnapshotJson,
            @routeDecisionJson, @status, @errorMessage, @createdAt
          )`,
        )
        .run({
          ...parsed,
          providerSnapshotJson:
            parsed.providerSnapshot === null
              ? null
              : JSON.stringify(parsed.providerSnapshot),
          routeDecisionJson:
            parsed.routeDecision === null
              ? null
              : JSON.stringify(parsed.routeDecision),
        });
    })();
  }

  updateAssistantMessage(
    id: string,
    patch: QuickChatAssistantMessageUpdate,
  ): void {
    this.writeGate.assertWritable();
    const parsed = quickChatAssistantMessageUpdateSchema.parse(patch);
    this.database.transaction(() => {
      const row = this.database
        .prepare("SELECT * FROM quick_chat_messages WHERE id = ?")
        .get(id) as QuickChatMessageRow | undefined;
      if (row === undefined) {
        throw new Error(`Message ${id} does not exist`);
      }
      const current = hydrateMessage(row);
      if (current.role !== "assistant") {
        throw new Error(`Message ${id} is not an assistant message`);
      }
      if (current.status !== "streaming") {
        throw new Error(`Message ${id} is no longer streaming`);
      }
      this.database
        .prepare(
          `UPDATE quick_chat_messages SET
            content = CASE WHEN @hasContent THEN @content ELSE content END,
            status = CASE WHEN @hasStatus THEN @status ELSE status END,
            error_message = CASE WHEN @hasErrorMessage THEN @errorMessage ELSE error_message END
           WHERE id = @id`,
        )
        .run({
          id,
          content: parsed.content ?? null,
          status: parsed.status ?? null,
          errorMessage: parsed.errorMessage ?? null,
          hasContent: parsed.content === undefined ? 0 : 1,
          hasStatus: parsed.status === undefined ? 0 : 1,
          hasErrorMessage: parsed.errorMessage === undefined ? 0 : 1,
        });
    })();
  }

  recoverInterrupted(): number {
    this.writeGate.assertWritable();
    return this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE quick_chat_messages
           SET status = 'failed',
               error_message = '上次运行意外中断，可以重试这条回复。'
           WHERE role = 'assistant' AND status = 'streaming'`,
        )
        .run();
      return Number(result.changes);
    })();
  }

  listMessages(sessionId: string): QuickChatMessage[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM quick_chat_messages
         WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(sessionId) as QuickChatMessageRow[];
    return rows.map(hydrateMessage);
  }

  private assertSessionExists(id: string): void {
    const session = this.database
      .prepare("SELECT 1 FROM quick_chat_sessions WHERE id = ?")
      .get(id);
    if (session === undefined) {
      throw new Error(`Session ${id} does not exist`);
    }
  }
}
