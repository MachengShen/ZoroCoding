import { randomUUID } from "node:crypto";

import type {
  QuickChatMessage,
  QuickChatSession,
} from "../../shared/domain";
import type { ModelSelection } from "../../shared/taskRouting";
import { ModelProviderError } from "../models/openAiCompatibleProvider";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
} from "../models/types";
import type { QuickChatRepository } from "../persistence/quickChatRepository";
import type { ModelRouter, ResolvedRoute } from "../routing/modelRouter";

const QUICK_CHAT_SYSTEM = [
  "你是 ZoroCoding 快速问答助手。",
  "本会话没有项目、文件或终端访问能力。",
  "不要声称已经读取、修改或运行本地内容。",
  "需要落盘、绘图或视频生成时，建议用户转为项目任务。",
].join("\n");

const MAX_PROMPT_LENGTH = 100_000;
const MAX_CONTENT_LENGTH = 100_000;
const MAX_TITLE_LENGTH = 48;
const MAX_HISTORY_CHARACTERS = 24_000;

type QuickChatRepositoryLike = Pick<
  QuickChatRepository,
  | "getSession"
  | "renameSession"
  | "insertMessage"
  | "updateAssistantMessage"
  | "listMessages"
>;

interface QuickChatRouterLike {
  resolve(input: {
    prompt: string;
    selection: ModelSelection;
  }): ResolvedRoute;
}

interface QuickChatGatewayLike {
  stream(providerId: string, request: ModelRequest): AsyncIterable<ModelEvent>;
}

interface QuickChatServiceDependencies {
  repository: QuickChatRepositoryLike;
  modelRouter: Pick<ModelRouter, "resolve"> | QuickChatRouterLike;
  modelGateway: QuickChatGatewayLike;
  createId?: () => string;
  now?: () => number;
}

interface ActiveOperation {
  controller: AbortController;
  completion: Promise<void>;
  complete(): void;
  generation: number;
}

export type QuickChatEvent =
  | { type: "session_updated"; session: QuickChatSession }
  | { type: "message_started"; message: QuickChatMessage }
  | {
      type: "message_delta";
      sessionId: string;
      messageId: string;
      text: string;
    }
  | { type: "message_completed"; message: QuickChatMessage }
  | { type: "message_failed"; message: QuickChatMessage };

function normalizePrompt(prompt: string): string {
  const normalized = prompt.trim();
  if (normalized.length === 0) {
    throw new Error("快速问答内容不能为空。");
  }
  if (normalized.length > MAX_PROMPT_LENGTH) {
    throw new Error("快速问答内容过长。");
  }
  return normalized;
}

function localTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/gu, " ").trim();
  return Array.from(normalized).slice(0, MAX_TITLE_LENGTH).join("");
}

function codePointLengthWithin(value: string, limit: number): number {
  let length = 0;
  const iterator = value[Symbol.iterator]();
  while (length <= limit) {
    const next = iterator.next();
    if (next.done) {
      return length;
    }
    length += 1;
  }
  return length;
}

function boundedCompletedConversation(
  messages: QuickChatMessage[],
): ModelMessage[] {
  const recent: ModelMessage[] = [];
  let remaining = MAX_HISTORY_CHARACTERS;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.status !== "completed") {
      continue;
    }
    const length = codePointLengthWithin(message.content, remaining);
    if (length > remaining) {
      break;
    }
    recent.push({
      role: message.role,
      content: message.content,
    });
    remaining -= length;
  }
  return recent.reverse();
}

function conversationWithCurrentPrompt(
  priorMessages: QuickChatMessage[],
  prompt: string,
): ModelMessage[] {
  return [
    ...boundedCompletedConversation(priorMessages),
    { role: "user", content: prompt },
  ];
}

function takeCodePoints(
  value: string,
  limit: number,
): { text: string; length: number } {
  if (limit <= 0) {
    return { text: "", length: 0 };
  }
  const iterator = value[Symbol.iterator]();
  let text = "";
  let length = 0;
  while (length < limit) {
    const next = iterator.next();
    if (next.done) {
      break;
    }
    text += next.value;
    length += 1;
  }
  return { text, length };
}

function storageAbortError(): DOMException {
  return new DOMException(
    "移动硬盘已断开，快速问答已中止。",
    "AbortError",
  );
}

function cancelAbortError(): DOMException {
  return new DOMException("快速问答已取消。", "AbortError");
}

function safeModelError(error: unknown): string {
  if (error instanceof ModelProviderError) {
    return error.failure.message;
  }
  return "模型请求失败，请稍后重试。";
}

function unsupportedToolCallError(): ModelProviderError {
  return new ModelProviderError({
    code: "invalid_response",
    message: "模型返回了快速问答不支持的工具调用。",
    retryable: false,
    retryAfterMs: null,
  });
}

export class QuickChatService {
  private readonly repository: QuickChatRepositoryLike;
  private readonly modelRouter: QuickChatRouterLike;
  private readonly modelGateway: QuickChatGatewayLike;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly listeners = new Set<(event: QuickChatEvent) => void>();
  private readonly active = new Map<string, ActiveOperation>();
  private storageInterrupted = false;
  private storageGeneration = 0;

  constructor(dependencies: QuickChatServiceDependencies) {
    this.repository = dependencies.repository;
    this.modelRouter = dependencies.modelRouter;
    this.modelGateway = dependencies.modelGateway;
    this.createId = dependencies.createId ?? randomUUID;
    this.now = dependencies.now ?? Date.now;
  }

  async send(input: {
    sessionId: string;
    prompt: string;
    selection: ModelSelection;
  }): Promise<QuickChatMessage> {
    const prompt = normalizePrompt(input.prompt);
    return this.runExclusive(input.sessionId, async (operation) => {
      const session = this.requireSession(input.sessionId);
      const previousMessages = this.repository.listMessages(input.sessionId);
      this.assertWritable(operation);

      const userMessage: QuickChatMessage = {
        id: this.createId(),
        sessionId: input.sessionId,
        role: "user",
        content: prompt,
        providerSnapshot: null,
        routeDecision: null,
        status: "completed",
        errorMessage: null,
        createdAt: this.now(),
      };
      this.repository.insertMessage(userMessage);

      if (previousMessages.length === 0) {
        this.assertWritable(operation);
        const updatedSession: QuickChatSession = {
          ...session,
          title: localTitle(prompt),
          updatedAt: this.now(),
        };
        this.repository.renameSession(
          updatedSession.id,
          updatedSession.title,
          updatedSession.updatedAt,
        );
        this.emit({
          type: "session_updated",
          session: updatedSession,
        });
      }

      const conversation = conversationWithCurrentPrompt(
        previousMessages,
        prompt,
      );
      return this.routeAndStream(
        input.sessionId,
        prompt,
        input.selection,
        conversation,
        operation,
      );
    });
  }

  async cancel(sessionId: string): Promise<void> {
    const operation = this.active.get(sessionId);
    if (operation === undefined) {
      return;
    }
    operation.controller.abort(cancelAbortError());
    await operation.completion;
  }

  async retry(input: {
    sessionId: string;
    messageId: string;
    selection: ModelSelection;
  }): Promise<QuickChatMessage> {
    return this.runExclusive(input.sessionId, async (operation) => {
      this.requireSession(input.sessionId);
      const messages = this.repository.listMessages(input.sessionId);
      const targetIndex = messages.findIndex(
        (message) =>
          message.id === input.messageId &&
          message.sessionId === input.sessionId,
      );
      if (targetIndex < 0) {
        throw new Error(`快速问答消息 ${input.messageId} 不存在。`);
      }
      const target = messages[targetIndex];
      if (
        target.role !== "assistant" ||
        !["failed", "canceled"].includes(target.status)
      ) {
        throw new Error("只有失败或已取消的助手回复可以重试。");
      }
      const sourceMessages = messages.slice(0, targetIndex);
      let sourcePromptIndex = -1;
      for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
        if (sourceMessages[index].role === "user") {
          sourcePromptIndex = index;
          break;
        }
      }
      if (sourcePromptIndex < 0) {
        throw new Error("找不到要重试的原始问题。");
      }
      const sourcePrompt = sourceMessages[sourcePromptIndex].content;
      this.assertWritable(operation);
      return this.routeAndStream(
        input.sessionId,
        sourcePrompt,
        input.selection,
        conversationWithCurrentPrompt(
          sourceMessages.slice(0, sourcePromptIndex),
          sourcePrompt,
        ),
        operation,
      );
    });
  }

  subscribe(listener: (event: QuickChatEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async interruptForStorageLoss(): Promise<void> {
    this.storageInterrupted = true;
    this.storageGeneration += 1;
    const operations = [...this.active.values()];
    for (const operation of operations) {
      operation.controller.abort(storageAbortError());
    }
    await Promise.all(operations.map((operation) => operation.completion));
  }

  private async routeAndStream(
    sessionId: string,
    prompt: string,
    selection: ModelSelection,
    conversation: ModelMessage[],
    operation: ActiveOperation,
  ): Promise<QuickChatMessage> {
    let route: ResolvedRoute;
    try {
      route = this.modelRouter.resolve({ prompt, selection });
    } catch {
      return this.persistPreRouteFailure(sessionId, operation);
    }
    this.assertWritable(operation);

    let assistant: QuickChatMessage = {
      id: this.createId(),
      sessionId,
      role: "assistant",
      content: "",
      providerSnapshot: route.provider,
      routeDecision: route.decision,
      status: "streaming",
      errorMessage: null,
      createdAt: this.now(),
    };
    this.repository.insertMessage(assistant);
    this.emit({ type: "message_started", message: assistant });

    let contentLength = 0;
    try {
      for await (const event of this.modelGateway.stream(
        route.provider.providerId,
        {
          messages: [
            { role: "system", content: QUICK_CHAT_SYSTEM },
            ...conversation,
          ],
          tools: [],
          signal: operation.controller.signal,
        },
      )) {
        this.assertOperationActive(operation);
        if (event.type === "tool_call") {
          throw unsupportedToolCallError();
        }
        if (event.type !== "text_delta") {
          continue;
        }
        const remaining = MAX_CONTENT_LENGTH - contentLength;
        if (remaining <= 0) {
          continue;
        }
        const accepted = takeCodePoints(event.text, remaining);
        if (accepted.length === 0) {
          continue;
        }
        contentLength += accepted.length;
        assistant = {
          ...assistant,
          content: assistant.content + accepted.text,
        };
        this.emit({
          type: "message_delta",
          sessionId,
          messageId: assistant.id,
          text: accepted.text,
        });
      }
      this.assertOperationActive(operation);
      assistant = {
        ...assistant,
        status: "completed",
        errorMessage: null,
      };
      this.repository.updateAssistantMessage(assistant.id, {
        content: assistant.content,
        status: "completed",
        errorMessage: null,
      });
      this.emit({ type: "message_completed", message: assistant });
      return assistant;
    } catch (error) {
      if (
        this.storageInterrupted ||
        operation.generation !== this.storageGeneration
      ) {
        throw operation.controller.signal.reason ?? storageAbortError();
      }
      if (operation.controller.signal.aborted) {
        this.assertWritable(operation);
        assistant = {
          ...assistant,
          status: "canceled",
          errorMessage: null,
        };
        this.repository.updateAssistantMessage(assistant.id, {
          content: assistant.content,
          status: "canceled",
          errorMessage: null,
        });
        this.emit({ type: "message_failed", message: assistant });
        return assistant;
      }
      this.assertWritable(operation);
      assistant = {
        ...assistant,
        status: "failed",
        errorMessage: safeModelError(error),
      };
      this.repository.updateAssistantMessage(assistant.id, {
        content: assistant.content,
        status: "failed",
        errorMessage: assistant.errorMessage,
      });
      this.emit({ type: "message_failed", message: assistant });
      return assistant;
    }
  }

  private persistPreRouteFailure(
    sessionId: string,
    operation: ActiveOperation,
  ): QuickChatMessage {
    this.assertWritable(operation);
    let assistant: QuickChatMessage = {
      id: this.createId(),
      sessionId,
      role: "assistant",
      content: "",
      providerSnapshot: null,
      routeDecision: null,
      status: "streaming",
      errorMessage: null,
      createdAt: this.now(),
    };
    this.repository.insertMessage(assistant);
    this.emit({ type: "message_started", message: assistant });
    this.assertWritable(operation);
    assistant = {
      ...assistant,
      status: "failed",
      errorMessage: "无法选择模型，请检查模型路由设置。",
    };
    this.repository.updateAssistantMessage(assistant.id, {
      status: "failed",
      errorMessage: assistant.errorMessage,
    });
    this.emit({ type: "message_failed", message: assistant });
    return assistant;
  }

  private requireSession(sessionId: string): QuickChatSession {
    const session = this.repository.getSession(sessionId);
    if (session === null) {
      throw new Error(`快速问答会话 ${sessionId} 不存在。`);
    }
    return session;
  }

  private assertWritable(operation: ActiveOperation): void {
    if (
      this.storageInterrupted ||
      operation.generation !== this.storageGeneration
    ) {
      throw storageAbortError();
    }
  }

  private assertOperationActive(operation: ActiveOperation): void {
    this.assertWritable(operation);
    if (operation.controller.signal.aborted) {
      throw operation.controller.signal.reason ?? cancelAbortError();
    }
  }

  private async runExclusive(
    sessionId: string,
    action: (operation: ActiveOperation) => Promise<QuickChatMessage>,
  ): Promise<QuickChatMessage> {
    if (this.storageInterrupted) {
      throw new Error(
        "移动硬盘已断开，无法执行会修改本地状态的操作。",
      );
    }
    if (this.active.has(sessionId)) {
      throw new Error("此会话已有回复正在生成。");
    }

    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const operation: ActiveOperation = {
      controller: new AbortController(),
      completion,
      complete,
      generation: this.storageGeneration,
    };
    this.active.set(sessionId, operation);
    try {
      return await action(operation);
    } finally {
      if (this.active.get(sessionId) === operation) {
        this.active.delete(sessionId);
      }
      operation.complete();
    }
  }

  private emit(event: QuickChatEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Event listeners are observational and must not break persistence.
      }
    }
  }
}
