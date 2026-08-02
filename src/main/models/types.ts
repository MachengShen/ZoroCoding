import type { ProviderConfig } from "../../shared/domain";

export type ModelRole = "system" | "user" | "assistant" | "tool";

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ModelMessage {
  role: ModelRole;
  content: string | null;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
}

export interface ModelToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ModelRequest {
  messages: ModelMessage[];
  tools: ModelToolDefinition[];
  signal?: AbortSignal;
}

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type ModelEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ModelToolCall }
  | { type: "usage"; usage: ModelUsage }
  | { type: "finish"; reason: string };

export interface ConnectionResult {
  ok: true;
  latencyMs: number;
}

export interface ModelFailure {
  code:
    | "auth"
    | "not_found"
    | "rate_limited"
    | "network"
    | "server"
    | "invalid_response";
  message: string;
  retryable: boolean;
  retryAfterMs: number | null;
}

export interface ModelProvider {
  readonly config: ProviderConfig;
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
  testConnection(signal?: AbortSignal): Promise<ConnectionResult>;
}
