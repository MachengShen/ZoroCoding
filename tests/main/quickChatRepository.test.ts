import { ZodError } from "zod";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../src/main/persistence/database";
import { StorageWriteGate } from "../../src/main/persistence/liveWriteGate";
import { QuickChatRepository } from "../../src/main/persistence/quickChatRepository";
import type {
  QuickChatMessage,
  QuickChatSession,
} from "../../src/shared/domain";

const connections: ReturnType<typeof openDatabase>[] = [];

function database() {
  const connection = openDatabase(":memory:");
  connections.push(connection);
  return connection;
}

function session(
  overrides: Partial<QuickChatSession> = {},
): QuickChatSession {
  return {
    id: "session-1",
    title: "Explain this code",
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function userMessage(
  overrides: Partial<QuickChatMessage> = {},
): QuickChatMessage {
  return {
    id: "message-user",
    sessionId: "session-1",
    role: "user",
    content: "What does this function do?",
    providerSnapshot: null,
    routeDecision: null,
    status: "completed",
    errorMessage: null,
    createdAt: 100,
    ...overrides,
  };
}

function assistantMessage(
  overrides: Partial<QuickChatMessage> = {},
): QuickChatMessage {
  return {
    id: "message-assistant",
    sessionId: "session-1",
    role: "assistant",
    content: "It starts by validating the input.",
    providerSnapshot: {
      providerId: "provider-1",
      name: "Team model",
      kind: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      modelId: "team-code",
      contextLength: 128_000,
    },
    routeDecision: {
      intent: "simple_code",
      lane: "light",
      executionMode: "read_only",
      confidence: "high",
      reasonCode: "code-explanation",
    },
    status: "streaming",
    errorMessage: null,
    createdAt: 200,
    ...overrides,
  };
}

afterEach(() => {
  for (const connection of connections.splice(0)) {
    connection.close();
  }
});

describe("QuickChatRepository", () => {
  it("creates, gets, lists, renames, and deletes sessions in stable recency order", () => {
    const repository = new QuickChatRepository(database());
    repository.createSession(session({ id: "session-z", updatedAt: 200 }));
    repository.createSession(session({ id: "session-a", updatedAt: 200 }));
    repository.createSession(session({ id: "session-old", updatedAt: 100 }));

    expect(repository.getSession("session-a")).toEqual(
      session({ id: "session-a", updatedAt: 200 }),
    );
    expect(repository.listSessions().map((item) => item.id)).toEqual([
      "session-a",
      "session-z",
      "session-old",
    ]);

    repository.renameSession("session-a", "A clearer question", 300);
    expect(repository.getSession("session-a")).toEqual({
      ...session({ id: "session-a", updatedAt: 200 }),
      title: "A clearer question",
      updatedAt: 300,
    });
    expect(() => repository.renameSession("missing", "No session", 400)).toThrow(
      "does not exist",
    );

    repository.deleteSession("session-z");
    expect(repository.getSession("session-z")).toBeNull();
    expect(() => repository.deleteSession("session-z")).toThrow("does not exist");
  });

  it("requires a session before inserting a message", () => {
    const repository = new QuickChatRepository(database());

    expect(() => repository.insertMessage(userMessage())).toThrow(
      "Session session-1 does not exist",
    );
  });

  it("rejects undeclared fields at quick chat session, message, and route boundaries", () => {
    const repository = new QuickChatRepository(database());

    expect(() =>
      repository.createSession({ ...session(), projectId: "project-1" } as never),
    ).toThrow(ZodError);
    repository.createSession(session());
    expect(() =>
      repository.insertMessage({ ...userMessage(), path: "/project" } as never),
    ).toThrow(ZodError);
    expect(() =>
      repository.insertMessage(
        assistantMessage({ command: "npm test", tools: ["shell"] } as never),
      ),
    ).toThrow(ZodError);
    expect(() =>
      repository.insertMessage(
        assistantMessage({
          routeDecision: {
            ...assistantMessage().routeDecision!,
            projectPath: "/project",
          } as never,
        }),
      ),
    ).toThrow(ZodError);
  });

  it("returns messages chronologically and persists assistant routing snapshots without secrets", () => {
    const db = database();
    const repository = new QuickChatRepository(db);
    repository.createSession(session());
    repository.insertMessage(assistantMessage());
    repository.insertMessage(userMessage({ createdAt: 100 }));

    expect(repository.listMessages("session-1")).toEqual([
      userMessage({ createdAt: 100 }),
      assistantMessage(),
    ]);
    expect(
      db
        .prepare(
          "SELECT provider_snapshot_json, route_decision_json FROM quick_chat_messages WHERE id = ?",
        )
        .get("message-assistant"),
    ).toEqual({
      provider_snapshot_json:
        '{"providerId":"provider-1","name":"Team model","kind":"openai-compatible","baseUrl":"https://api.example.com/v1","modelId":"team-code","contextLength":128000}',
      route_decision_json:
        '{"intent":"simple_code","lane":"light","executionMode":"read_only","confidence":"high","reasonCode":"code-explanation"}',
    });
    expect(() =>
      repository.insertMessage(
        assistantMessage({
          id: "message-secret",
          providerSnapshot: {
            ...assistantMessage().providerSnapshot!,
            apiKey: "should-never-persist",
          } as never,
        }),
      ),
    ).toThrow();
    expect(
      db
        .prepare(
          "SELECT COUNT(*) FROM quick_chat_messages WHERE id = ?",
        )
        .pluck()
        .get("message-secret"),
    ).toBe(0);
  });

  it("keeps assistant provider and route snapshots immutable while streaming completes", () => {
    const repository = new QuickChatRepository(database());
    repository.createSession(session());
    repository.insertMessage(assistantMessage());

    repository.updateAssistantMessage("message-assistant", {
      content: "It starts by validating the input, then returns a result.",
      status: "completed",
      errorMessage: null,
    });
    expect(repository.listMessages("session-1")).toEqual([
      assistantMessage({
        content: "It starts by validating the input, then returns a result.",
        status: "completed",
      }),
    ]);
    expect(() =>
      repository.updateAssistantMessage("message-assistant", {
        providerSnapshot: {
          providerId: "provider-2",
        },
      } as never),
    ).toThrow();
    expect(() =>
      repository.updateAssistantMessage("message-assistant", {
        routeDecision: { lane: "premium" },
      } as never),
    ).toThrow();
    expect(repository.listMessages("session-1")[0]).toEqual(
      assistantMessage({
        content: "It starts by validating the input, then returns a result.",
        status: "completed",
      }),
    );
  });

  it("persists terminal assistant failures and cancellations", () => {
    const repository = new QuickChatRepository(database());
    repository.createSession(session());
    repository.insertMessage(assistantMessage());
    repository.insertMessage(
      assistantMessage({ id: "message-canceled", createdAt: 300 }),
    );

    repository.updateAssistantMessage("message-assistant", {
      status: "failed",
      errorMessage: "The provider timed out.",
    });
    repository.updateAssistantMessage("message-canceled", {
      status: "canceled",
      errorMessage: null,
    });

    expect(repository.listMessages("session-1")).toEqual([
      assistantMessage({
        status: "failed",
        errorMessage: "The provider timed out.",
      }),
      assistantMessage({
        id: "message-canceled",
        createdAt: 300,
        status: "canceled",
      }),
    ]);
  });

  it("atomically recovers interrupted streaming assistants as retryable failures", () => {
    const db = database();
    const repository = new QuickChatRepository(db);
    repository.createSession(session());
    repository.insertMessage(userMessage());
    repository.insertMessage(
      assistantMessage({
        content: "已生成的部分内容",
      }),
    );
    const restartedRepository = new QuickChatRepository(db);

    expect(restartedRepository.recoverInterrupted()).toBe(1);

    expect(restartedRepository.listMessages("session-1")).toEqual([
      userMessage(),
      assistantMessage({
        content: "已生成的部分内容",
        status: "failed",
        errorMessage: "上次运行意外中断，可以重试这条回复。",
      }),
    ]);
    expect(restartedRepository.recoverInterrupted()).toBe(0);
  });

  it("round-trips failed and canceled assistants without routing metadata", () => {
    const repository = new QuickChatRepository(database());
    repository.createSession(session());
    repository.insertMessage(
      assistantMessage({
        id: "message-failed-without-route",
        providerSnapshot: null,
        routeDecision: null,
        status: "failed",
        errorMessage: "No configured provider is available.",
      }),
    );
    repository.insertMessage(
      assistantMessage({
        id: "message-canceled-without-route",
        providerSnapshot: null,
        routeDecision: null,
        status: "canceled",
        errorMessage: null,
        createdAt: 300,
      }),
    );

    expect(repository.listMessages("session-1")).toEqual([
      assistantMessage({
        id: "message-failed-without-route",
        providerSnapshot: null,
        routeDecision: null,
        status: "failed",
        errorMessage: "No configured provider is available.",
      }),
      assistantMessage({
        id: "message-canceled-without-route",
        providerSnapshot: null,
        routeDecision: null,
        status: "canceled",
        errorMessage: null,
        createdAt: 300,
      }),
    ]);
    expect(() =>
      repository.insertMessage(
        userMessage({ providerSnapshot: assistantMessage().providerSnapshot }),
      ),
    ).toThrow(ZodError);
  });

  it("does not allow updating a user message as an assistant message", () => {
    const repository = new QuickChatRepository(database());
    repository.createSession(session());
    repository.insertMessage(userMessage());

    expect(() =>
      repository.updateAssistantMessage("message-user", { status: "completed" }),
    ).toThrow("is not an assistant message");
  });

  it("cascades messages when a session is deleted", () => {
    const repository = new QuickChatRepository(database());
    repository.createSession(session());
    repository.insertMessage(userMessage());
    repository.insertMessage(assistantMessage());

    repository.deleteSession("session-1");

    expect(repository.listMessages("session-1")).toEqual([]);
  });

  it("rejects invalid persisted message JSON and statuses during hydration", () => {
    const db = database();
    const repository = new QuickChatRepository(db);
    repository.createSession(session());
    db.prepare(
      `INSERT INTO quick_chat_messages(
        id, session_id, role, content, provider_snapshot_json,
        route_decision_json, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "invalid-snapshot",
      "session-1",
      "assistant",
      "Broken snapshot",
      '{"providerId":"provider-1"}',
      JSON.stringify(assistantMessage().routeDecision),
      "completed",
      null,
      100,
    );

    expect(() => repository.listMessages("session-1")).toThrow();

    db.prepare("DELETE FROM quick_chat_messages WHERE id = ?").run("invalid-snapshot");
    db.prepare(
      `INSERT INTO quick_chat_messages(
        id, session_id, role, content, provider_snapshot_json,
        route_decision_json, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "invalid-status",
      "session-1",
      "assistant",
      "Broken status",
      JSON.stringify(assistantMessage().providerSnapshot),
      JSON.stringify(assistantMessage().routeDecision),
      "paused",
      null,
      100,
    );

    expect(() => repository.listMessages("session-1")).toThrow();
  });

  it("returns Zod errors for malformed serialized provider and route JSON", () => {
    const db = database();
    const repository = new QuickChatRepository(db);
    repository.createSession(session());
    db.prepare(
      `INSERT INTO quick_chat_messages(
        id, session_id, role, content, provider_snapshot_json,
        route_decision_json, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "malformed-provider",
      "session-1",
      "assistant",
      "Broken provider JSON",
      "{broken",
      JSON.stringify(assistantMessage().routeDecision),
      "failed",
      "The provider response was invalid.",
      100,
    );

    expect(() => repository.listMessages("session-1")).toThrow(ZodError);

    db.prepare("DELETE FROM quick_chat_messages WHERE id = ?").run("malformed-provider");
    db.prepare(
      `INSERT INTO quick_chat_messages(
        id, session_id, role, content, provider_snapshot_json,
        route_decision_json, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "malformed-route",
      "session-1",
      "assistant",
      "Broken route JSON",
      JSON.stringify(assistantMessage().providerSnapshot),
      "{broken",
      "failed",
      "The route decision was invalid.",
      100,
    );

    expect(() => repository.listMessages("session-1")).toThrow(ZodError);
  });

  it("denies every quick chat write once storage is unavailable", () => {
    let writable = true;
    const repository = new QuickChatRepository(
      database(),
      new StorageWriteGate(() => writable),
    );
    repository.createSession(session());
    repository.insertMessage(assistantMessage());
    writable = false;

    expect(() => repository.createSession(session({ id: "session-2" }))).toThrow(
      "移动硬盘已断开",
    );
    expect(() => repository.renameSession("session-1", "Renamed", 200)).toThrow(
      "移动硬盘已断开",
    );
    expect(() => repository.deleteSession("session-1")).toThrow("移动硬盘已断开");
    expect(() => repository.insertMessage(userMessage())).toThrow("移动硬盘已断开");
    expect(() =>
      repository.updateAssistantMessage("message-assistant", { status: "completed" }),
    ).toThrow("移动硬盘已断开");
    expect(() => repository.recoverInterrupted()).toThrow("移动硬盘已断开");
    expect(repository.getSession("session-1")?.title).toBe("Explain this code");
    expect(repository.listMessages("session-1")[0]?.status).toBe("streaming");
  });
});
