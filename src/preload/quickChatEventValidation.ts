import type {
  QuickChatMessage,
  QuickChatSession,
} from "../shared/domain";
import type {
  QuickChatEvent,
  QuickChatEventEnvelope,
} from "../shared/ipc";
import type { RouteDecision } from "../shared/taskRouting";

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 || normalized.length > 256
    ? null
    : normalized;
}

function cloneSession(value: unknown): QuickChatSession | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "title", "createdAt", "updatedAt"]) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.title) ||
    !Number.isFinite(value.createdAt) ||
    !Number.isFinite(value.updatedAt)
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    createdAt: value.createdAt as number,
    updatedAt: value.updatedAt as number,
  };
}

function cloneProviderSnapshot(
  value: unknown,
): QuickChatMessage["providerSnapshot"] | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "providerId",
      "name",
      "kind",
      "baseUrl",
      "modelId",
      "contextLength",
    ]) ||
    !isNonEmptyString(value.providerId) ||
    !isNonEmptyString(value.name) ||
    (value.kind !== "kimi" && value.kind !== "openai-compatible") ||
    !isNonEmptyString(value.baseUrl) ||
    !isNonEmptyString(value.modelId) ||
    !Number.isInteger(value.contextLength) ||
    (value.contextLength as number) <= 0
  ) {
    return undefined;
  }
  return {
    providerId: value.providerId,
    name: value.name,
    kind: value.kind,
    baseUrl: value.baseUrl,
    modelId: value.modelId,
    contextLength: value.contextLength as number,
  };
}

function cloneRouteDecision(value: unknown): RouteDecision | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "intent",
      "lane",
      "executionMode",
      "confidence",
      "reasonCode",
    ]) ||
    ![
      "simple_qa",
      "simple_text",
      "simple_code",
      "complex_code",
      "media_script",
    ].includes(value.intent as string) ||
    !["light", "premium"].includes(value.lane as string) ||
    !["read_only", "agentic"].includes(value.executionMode as string) ||
    !["high", "medium"].includes(value.confidence as string) ||
    ![
      "simple-question",
      "text-transform",
      "code-explanation",
      "project-change",
      "multi-step-code",
      "media-generation",
      "ambiguous-premium-default",
    ].includes(value.reasonCode as string)
  ) {
    return undefined;
  }
  return {
    intent: value.intent as RouteDecision["intent"],
    lane: value.lane as RouteDecision["lane"],
    executionMode: value.executionMode as RouteDecision["executionMode"],
    confidence: value.confidence as RouteDecision["confidence"],
    reasonCode: value.reasonCode as RouteDecision["reasonCode"],
  };
}

function cloneMessage(value: unknown): QuickChatMessage | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "sessionId",
      "role",
      "content",
      "providerSnapshot",
      "routeDecision",
      "status",
      "errorMessage",
      "createdAt",
    ]) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.sessionId) ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string" ||
    !["streaming", "completed", "failed", "canceled"].includes(
      value.status as string,
    ) ||
    (value.errorMessage !== null && typeof value.errorMessage !== "string") ||
    !Number.isFinite(value.createdAt)
  ) {
    return null;
  }

  if (
    value.role === "user" &&
    (value.providerSnapshot !== null || value.routeDecision !== null)
  ) {
    return null;
  }
  const providerSnapshot =
    value.providerSnapshot === null
      ? null
      : cloneProviderSnapshot(value.providerSnapshot);
  const routeDecision =
    value.routeDecision === null
      ? null
      : cloneRouteDecision(value.routeDecision);
  if (providerSnapshot === undefined || routeDecision === undefined) {
    return null;
  }

  return {
    id: value.id,
    sessionId: value.sessionId,
    role: value.role,
    content: value.content,
    providerSnapshot,
    routeDecision,
    status: value.status as QuickChatMessage["status"],
    errorMessage: value.errorMessage,
    createdAt: value.createdAt as number,
  };
}

function cloneEvent(value: unknown): QuickChatEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (value.type === "session_updated") {
    if (!hasExactKeys(value, ["type", "session"])) return null;
    const session = cloneSession(value.session);
    return session === null ? null : { type: value.type, session };
  }
  if (
    value.type === "message_started" ||
    value.type === "message_completed" ||
    value.type === "message_failed"
  ) {
    if (!hasExactKeys(value, ["type", "message"])) return null;
    const message = cloneMessage(value.message);
    return message === null ? null : { type: value.type, message };
  }
  if (value.type === "message_delta") {
    const sessionId = normalizeIdentifier(value.sessionId);
    const messageId = normalizeIdentifier(value.messageId);
    if (
      !hasExactKeys(value, [
        "type",
        "sessionId",
        "messageId",
        "text",
      ]) ||
      sessionId === null ||
      messageId === null ||
      typeof value.text !== "string" ||
      value.text.length > 100_000
    ) {
      return null;
    }
    return {
      type: value.type,
      sessionId,
      messageId,
      text: value.text,
    };
  }
  return null;
}

export function cloneQuickChatEventEnvelope(
  value: unknown,
): QuickChatEventEnvelope | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["subscriptionId", "event"])
  ) {
    return null;
  }
  const subscriptionId = normalizeIdentifier(value.subscriptionId);
  if (
    subscriptionId === null
  ) {
    return null;
  }
  const event = cloneEvent(value.event);
  if (event === null) {
    return null;
  }
  return {
    subscriptionId,
    event,
  };
}
