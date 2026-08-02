import type { ProviderConfig } from "../../shared/domain";
import type {
  ConnectionResult,
  ModelEvent,
  ModelFailure,
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelToolCall,
} from "./types";

interface OpenAiToolFragment {
  index: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAiChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: OpenAiToolFragment[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}

export class ModelProviderError extends Error {
  constructor(readonly failure: ModelFailure) {
    super(failure.message);
    this.name = "ModelProviderError";
  }
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (value === null) {
    return null;
  }
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1_000) : null;
}

function failureForResponse(response: Response): ModelFailure {
  if (response.status === 401 || response.status === 403) {
    return {
      code: "auth",
      message: "模型 API 鉴权失败，请检查 API Key。",
      retryable: false,
      retryAfterMs: null,
    };
  }
  if (response.status === 404) {
    return {
      code: "not_found",
      message: "未找到模型或 API 地址，请检查 Base URL 和模型 ID。",
      retryable: false,
      retryAfterMs: null,
    };
  }
  if (response.status === 429) {
    return {
      code: "rate_limited",
      message: "模型服务请求过于频繁，请稍后重试。",
      retryable: true,
      retryAfterMs: retryAfterMs(response),
    };
  }
  return {
    code: "server",
    message: "模型服务暂时不可用。",
    retryable: response.status >= 500,
    retryAfterMs: null,
  };
}

function toOpenAiMessage(message: ModelMessage): Record<string, unknown> {
  const output: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };
  if (message.toolCallId !== undefined) {
    output.tool_call_id = message.toolCallId;
  }
  if (message.toolCalls !== undefined) {
    output.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: call.arguments,
      },
    }));
  }
  return output;
}

export class OpenAiCompatibleProvider implements ModelProvider {
  constructor(
    readonly config: ProviderConfig,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    try {
      const response = await this.fetchImpl(this.completionsUrl(), {
        method: "POST",
        signal: request.signal,
        headers: {
          ...this.config.headers,
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.modelId,
          messages: request.messages.map(toOpenAiMessage),
          tools: request.tools,
          tool_choice: "auto",
          stream: true,
          stream_options: { include_usage: true },
        }),
      });

      if (!response.ok) {
        throw new ModelProviderError(failureForResponse(response));
      }
      if (response.body === null) {
        throw new ModelProviderError({
          code: "invalid_response",
          message: "模型服务没有返回可读取的流。",
          retryable: false,
          retryAfterMs: null,
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const pendingCalls = new Map<number, ModelToolCall>();
      let buffered = "";

      while (true) {
        const { done, value } = await reader.read();
        buffered += decoder.decode(value, { stream: !done }).replaceAll(
          "\r\n",
          "\n",
        );
        let boundary = buffered.indexOf("\n\n");

        while (boundary >= 0) {
          const frame = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          for (const event of this.parseFrame(frame, pendingCalls)) {
            yield event;
          }
          boundary = buffered.indexOf("\n\n");
        }

        if (done) {
          break;
        }
      }
    } catch (error) {
      if (error instanceof ModelProviderError) {
        throw error;
      }
      throw new ModelProviderError({
        code: "network",
        message: "无法连接模型服务，请检查网络和 API 地址。",
        retryable: true,
        retryAfterMs: null,
      });
    }
  }

  async testConnection(signal?: AbortSignal): Promise<ConnectionResult> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(this.completionsUrl(), {
        method: "POST",
        signal,
        headers: {
          ...this.config.headers,
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.modelId,
          messages: [{ role: "user", content: "Reply OK." }],
          max_tokens: 1,
          stream: false,
        }),
      });
    } catch {
      throw new ModelProviderError({
        code: "network",
        message: "无法连接模型服务，请检查网络和 API 地址。",
        retryable: true,
        retryAfterMs: null,
      });
    }
    if (!response.ok) {
      throw new ModelProviderError(failureForResponse(response));
    }
    return { ok: true, latencyMs: Date.now() - startedAt };
  }

  private completionsUrl(): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  private parseFrame(
    frame: string,
    pendingCalls: Map<number, ModelToolCall>,
  ): ModelEvent[] {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data.length === 0 || data === "[DONE]") {
      return [];
    }

    let chunk: OpenAiChunk;
    try {
      chunk = JSON.parse(data) as OpenAiChunk;
    } catch {
      throw new ModelProviderError({
        code: "invalid_response",
        message: "模型服务返回了无法解析的数据。",
        retryable: false,
        retryAfterMs: null,
      });
    }

    const events: ModelEvent[] = [];
    const choice = chunk.choices?.[0];
    const text = choice?.delta?.content;
    if (typeof text === "string" && text.length > 0) {
      events.push({ type: "text_delta", text });
    }

    for (const fragment of choice?.delta?.tool_calls ?? []) {
      const current = pendingCalls.get(fragment.index) ?? {
        id: "",
        name: "",
        arguments: "",
      };
      pendingCalls.set(fragment.index, {
        id: fragment.id ?? current.id,
        name: current.name + (fragment.function?.name ?? ""),
        arguments:
          current.arguments + (fragment.function?.arguments ?? ""),
      });
    }

    if (chunk.usage !== null && chunk.usage !== undefined) {
      events.push({
        type: "usage",
        usage: {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens ?? 0,
        },
      });
    }

    const finishReason = choice?.finish_reason;
    if (typeof finishReason === "string") {
      if (finishReason === "tool_calls") {
        for (const [, call] of [...pendingCalls.entries()].sort(
          ([left], [right]) => left - right,
        )) {
          events.push({ type: "tool_call", call });
        }
        pendingCalls.clear();
      }
      events.push({ type: "finish", reason: finishReason });
    }

    return events;
  }
}
