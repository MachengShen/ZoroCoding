import { z } from "zod";

import type { ModelOption } from "../../shared/domain";
import { addProviderSecurityIssues } from "../../shared/providerValidation";

export interface ModelDiscoveryInput {
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const PREFERRED_TERMS = ["code", "coder", "qwen", "glm", "gpt-oss"];

const modelDiscoveryInputSchema = z
  .object({
    baseUrl: z.string().trim().url(),
    apiKey: z.string().trim().min(1).max(4_096),
    headers: z.record(z.string(), z.string()).optional().default({}),
    fetchImpl: z
      .custom<typeof fetch>(
        (value) => typeof value === "function",
        "fetchImpl must be a function",
      )
      .optional(),
    signal: z
      .custom<AbortSignal>(
        (value) => value instanceof AbortSignal,
        "signal must be an AbortSignal",
      )
      .optional(),
  })
  .strict()
  .superRefine((input, context) =>
    addProviderSecurityIssues(
      {
        name: "Model discovery",
        kind: "openai-compatible",
        baseUrl: input.baseUrl,
        modelId: "model-discovery",
        contextLength: 1_024,
        headers: input.headers,
        isDefault: false,
      },
      context,
    ),
  );

export type ParsedModelDiscoveryInput = z.infer<
  typeof modelDiscoveryInputSchema
>;

export function parseModelDiscoveryInput(
  input: ModelDiscoveryInput,
): ParsedModelDiscoveryInput {
  return modelDiscoveryInputSchema.parse(input);
}

export function normalizeProviderBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (!url.hostname.startsWith("[")) {
    url.hostname = url.hostname.replace(/\.+$/, "");
  }
  url.pathname = url.pathname.replace(
    /%([0-9a-fA-F]{2})/g,
    (encoded, hex: string) => {
      const character = String.fromCharCode(Number.parseInt(hex, 16));
      return /^[A-Za-z0-9\-._~]$/.test(character)
        ? character
        : `%${hex.toUpperCase()}`;
    },
  );

  const normalized = new URL(url.toString());
  normalized.pathname = normalized.pathname
    .replace(/%([0-9a-fA-F]{2})/g, (_encoded, hex: string) => {
      return `%${hex.toUpperCase()}`;
    })
    .replace(/\/+$/, "");
  return normalized.toString().replace(/\/+(?=[?#]|$)/, "");
}

function isPreferred(id: string): boolean {
  const normalized = id.toLowerCase();
  return PREFERRED_TERMS.some((term) => normalized.includes(term));
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function throwIfCancelled(
  error: unknown,
  signal: AbortSignal | undefined,
): void {
  if (isAbortError(error)) {
    throw error;
  }
  if (signal?.aborted === true) {
    throw new DOMException("模型列表请求已取消。", "AbortError");
  }
}

export async function discoverModels(
  input: ModelDiscoveryInput,
): Promise<ModelOption[]> {
  const parsed = parseModelDiscoveryInput(input);
  const baseUrl = normalizeProviderBaseUrl(parsed.baseUrl);
  let response: Response;
  try {
    response = await (parsed.fetchImpl ?? fetch)(`${baseUrl}/models`, {
      method: "GET",
      signal: parsed.signal,
      headers: {
        ...parsed.headers,
        authorization: `Bearer ${parsed.apiKey}`,
      },
    });
  } catch (error) {
    throwIfCancelled(error, parsed.signal);
    throw new Error("无法连接模型列表服务，请检查网络和 API 地址。");
  }
  if (!response.ok) {
    throw new Error(`模型列表请求失败（HTTP ${response.status}）。`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throwIfCancelled(error, parsed.signal);
    throw new Error("模型列表服务返回了无法解析的数据。");
  }
  const data =
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : [];
  return data
    .flatMap((item): ModelOption[] => {
      const id =
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string"
          ? (item as { id: string }).id
          : "";
      return id.length >= 1 && id.length <= 200 ? [{ id, label: id }] : [];
    })
    .sort(
      (left, right) =>
        Number(isPreferred(right.id)) - Number(isPreferred(left.id)),
    )
    .slice(0, 500);
}
