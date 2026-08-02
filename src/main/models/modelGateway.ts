import type {
  ProviderConfig,
  ProviderKind,
  ProviderSnapshot,
} from "../../shared/domain";
import { assertProviderSecurity } from "../../shared/providerValidation";
import type { ProviderRepository } from "../persistence/providerRepository";
import type { SecretStore } from "../secrets/secretStore";
import { createHash, randomUUID } from "node:crypto";
import {
  discoverModels,
  normalizeProviderBaseUrl,
  parseModelDiscoveryInput,
  type ModelDiscoveryInput,
} from "./modelDiscovery";
import {
  ModelProviderError,
  OpenAiCompatibleProvider,
} from "./openAiCompatibleProvider";
import type {
  ConnectionResult,
  ModelEvent,
  ModelRequest,
} from "./types";
import { PROVIDER_TEMPLATES } from "./providerTemplates";

const kimiCatalogTemplate = PROVIDER_TEMPLATES.find(
  (template) => template.id === "kimi-k3",
);
if (
  kimiCatalogTemplate === undefined ||
  kimiCatalogTemplate.kind !== "kimi" ||
  kimiCatalogTemplate.suggestedModelId === undefined
) {
  throw new Error("KIMI K3 provider template is invalid");
}

export const KIMI_PROVIDER_TEMPLATE = Object.freeze({
  name: kimiCatalogTemplate.name,
  kind: kimiCatalogTemplate.kind,
  baseUrl: kimiCatalogTemplate.baseUrl,
  modelId: kimiCatalogTemplate.suggestedModelId,
  contextLength: kimiCatalogTemplate.contextLength,
  headers: {},
});

export interface CreateProviderInput {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  modelId: string;
  contextLength: number;
  headers: Record<string, string>;
  apiKey: string;
  isDefault: boolean;
  billingNote?: string;
  dashboardUrl?: string;
  now: number;
}

export interface UpdateProviderInput {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  modelId: string;
  contextLength: number;
  headers: Record<string, string>;
  apiKey?: string;
  isDefault: boolean;
  billingNote?: string;
  dashboardUrl?: string;
  now: number;
}

export interface TestProviderInput {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  modelId: string;
  contextLength: number;
  headers: Record<string, string>;
  apiKey: string;
}

function normalizeBaseUrl(value: string): string {
  return normalizeProviderBaseUrl(value);
}

function normalizedHeaders(
  headers: Record<string, string>,
): Array<[string, string]> {
  return Object.entries(headers)
    .map(([name, value]): [string, string] => [
      name.toLowerCase(),
      value.trim(),
    ])
    .sort(([left], [right]) => left.localeCompare(right));
}

function discoveryFingerprint(input: {
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        baseUrl: normalizeBaseUrl(input.baseUrl),
        apiKey: input.apiKey,
        headers: normalizedHeaders(input.headers),
      }),
    )
    .digest("hex");
}

function requiresAuthenticatedDiscovery(baseUrl: string): boolean {
  const normalized = normalizeBaseUrl(baseUrl);
  return PROVIDER_TEMPLATES.some(
    (template) =>
      template.requiresDiscovery &&
      normalizeBaseUrl(template.baseUrl) === normalized,
  );
}

function safeConnectionMessage(error: unknown): string {
  return error instanceof ModelProviderError
    ? error.failure.message
    : "模型连接测试失败，请检查配置后重试。";
}

interface ProviderOperation {
  signal: AbortSignal;
  assertActive(): void;
  finish(): void;
}

function providerOperationAbortError(): DOMException {
  return new DOMException("模型操作已取消。", "AbortError");
}

export class ModelGateway {
  private readonly discoveredModels = new Map<string, Set<string>>();
  private readonly activeProviderOperations = new Set<AbortController>();
  private storageGeneration = 0;

  constructor(
    private readonly providers: ProviderRepository,
    private readonly secrets: SecretStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly isProviderInUse: (providerId: string) => boolean = () =>
      false,
    private readonly createSecretVersion: () => string = randomUUID,
    private readonly now: () => number = Date.now,
  ) {}

  async createProvider(input: CreateProviderInput): Promise<ProviderConfig> {
    assertProviderSecurity(input);
    this.assertDiscoveryAuthorized(input);
    const secretRef = `provider/${input.id}/${this.createSecretVersion()}`;
    await this.secrets.put(secretRef, input.apiKey);
    try {
      return this.providers.create({
        id: input.id,
        name: input.name,
        kind: input.kind,
        baseUrl: normalizeBaseUrl(input.baseUrl),
        modelId: input.modelId,
        contextLength: input.contextLength,
        headers: input.headers,
        secretRef,
        keySuffix: input.apiKey.slice(-4),
        isDefault: input.isDefault,
        connectionStatus: "untested",
        connectionMessage: null,
        lastTestedAt: null,
        billingNote:
          input.billingNote ?? "计费规则由服务商决定",
        dashboardUrl: input.dashboardUrl ?? "",
        createdAt: input.now,
        updatedAt: input.now,
      });
    } catch (error) { throw error; }
  }

  async updateProvider(
    providerId: string,
    input: UpdateProviderInput,
  ): Promise<ProviderConfig> {
    assertProviderSecurity(input);
    const current = this.requireConfig(providerId);
    const changesKey = input.apiKey !== undefined;
    const nextKey = input.apiKey;
    const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl);
    const executionConfigurationChanged =
      current.kind !== input.kind ||
      normalizeBaseUrl(current.baseUrl) !== normalizedBaseUrl ||
      current.modelId !== input.modelId ||
      current.contextLength !== input.contextLength ||
      JSON.stringify(normalizedHeaders(current.headers)) !==
        JSON.stringify(normalizedHeaders(input.headers)) ||
      changesKey;
    this.assertProviderExecutionConfigurationMutable(
      providerId,
      executionConfigurationChanged,
    );
    const currentIsProtected = requiresAuthenticatedDiscovery(
      current.baseUrl,
    );
    const nextIsProtected =
      requiresAuthenticatedDiscovery(normalizedBaseUrl);
    const protectedConfigurationChanged =
      (currentIsProtected || nextIsProtected) &&
      (normalizeBaseUrl(current.baseUrl) !== normalizedBaseUrl ||
        current.modelId !== input.modelId ||
        JSON.stringify(normalizedHeaders(current.headers)) !==
          JSON.stringify(normalizedHeaders(input.headers)) ||
        changesKey);
    if (protectedConfigurationChanged) {
      const apiKey =
        nextKey ?? (await this.secrets.get(current.secretRef));
      this.assertProviderExecutionConfigurationMutable(
        providerId,
        executionConfigurationChanged,
      );
      if (apiKey === null) {
        throw new Error("模型 API Key 不存在");
      }
      this.assertDiscoveryAuthorized({
        baseUrl: normalizedBaseUrl,
        apiKey,
        headers: input.headers,
        modelId: input.modelId,
      }, true);
    }
    const nextSecretRef = changesKey
      ? `provider/${providerId}/${this.createSecretVersion()}`
      : current.secretRef;
    if (changesKey) {
      await this.secrets.put(nextSecretRef, nextKey!);
      try {
        this.assertProviderExecutionConfigurationMutable(
          providerId,
          executionConfigurationChanged,
        );
      } catch (error) {
        await this.secrets.remove(nextSecretRef);
        throw error;
      }
    }
    try {
      this.assertProviderExecutionConfigurationMutable(
        providerId,
        executionConfigurationChanged,
      );
      const updated = this.providers.update(providerId, {
        ...current,
        name: input.name,
        kind: input.kind,
        baseUrl: normalizedBaseUrl,
        modelId: input.modelId,
        contextLength: input.contextLength,
        headers: input.headers,
        secretRef: nextSecretRef,
        keySuffix: changesKey ? nextKey!.slice(-4) : current.keySuffix,
        isDefault: input.isDefault,
        billingNote: input.billingNote ?? current.billingNote,
        dashboardUrl: input.dashboardUrl ?? current.dashboardUrl,
        updatedAt: input.now,
      });
      if (changesKey) await this.secrets.remove(current.secretRef).catch(() => {});
      return updated;
    } catch (error) {
      throw error;
    }
  }

  async testProvider(
    providerId: string,
    signal?: AbortSignal,
  ): Promise<ConnectionResult> {
    return (await this.resolveProvider(providerId)).testConnection(signal);
  }

  getProviderSnapshot(providerId: string): ProviderSnapshot | null {
    const config = this.providers.get(providerId);
    if (config === null) return null;
    return {
      providerId: config.id,
      name: config.name,
      kind: config.kind,
      baseUrl: config.baseUrl,
      modelId: config.modelId,
      contextLength: config.contextLength,
    };
  }

  async discoverDraftModels(
    input: Omit<ModelDiscoveryInput, "fetchImpl">,
  ): Promise<Awaited<ReturnType<typeof discoverModels>>> {
    const operation = this.beginProviderOperation(input.signal);
    try {
      const parsed = parseModelDiscoveryInput({
        ...input,
        fetchImpl: this.fetchImpl,
        signal: operation.signal,
      });
      const models = await discoverModels(parsed);
      operation.assertActive();
      this.discoveredModels.set(
        discoveryFingerprint({
          baseUrl: parsed.baseUrl,
          apiKey: parsed.apiKey,
          headers: parsed.headers,
        }),
        new Set(models.map((model) => model.id)),
      );
      return models;
    } catch (error) {
      operation.assertActive();
      throw error;
    } finally {
      operation.finish();
    }
  }

  async testAndRecordProvider(
    providerId: string,
    signal?: AbortSignal,
  ): Promise<ConnectionResult> {
    const operation = this.beginProviderOperation(signal);
    try {
      this.requireConfig(providerId);
      let result: ConnectionResult;
      try {
        const provider = await this.resolveProvider(providerId);
        operation.assertActive();
        result = await provider.testConnection(operation.signal);
        operation.assertActive();
      } catch (error) {
        operation.assertActive();
        try {
          this.providers.updateHealth(providerId, {
            connectionStatus: "error",
            connectionMessage: safeConnectionMessage(error),
            lastTestedAt: this.now(),
          });
        } catch {
          // A local persistence failure must not replace the remote error.
        }
        throw error;
      }
      this.providers.updateHealth(providerId, {
        connectionStatus: "connected",
        connectionMessage: "连接正常",
        lastTestedAt: this.now(),
      });
      return result;
    } finally {
      operation.finish();
    }
  }

  async testDraft(
    input: TestProviderInput,
    signal?: AbortSignal,
  ): Promise<ConnectionResult> {
    const operation = this.beginProviderOperation(signal);
    try {
      assertProviderSecurity(input);
      const result = await new OpenAiCompatibleProvider(
        {
          id: "connection-test",
          name: input.name,
          kind: input.kind,
          baseUrl: normalizeBaseUrl(input.baseUrl),
          modelId: input.modelId,
          contextLength: input.contextLength,
          headers: input.headers,
          secretRef: "connection-test",
          keySuffix: input.apiKey.slice(-4),
          isDefault: false,
          connectionStatus: "untested",
          connectionMessage: null,
          lastTestedAt: null,
          billingNote: "计费规则由服务商决定",
          dashboardUrl: "",
          createdAt: 0,
          updatedAt: 0,
        },
        input.apiKey,
        this.fetchImpl,
      ).testConnection(operation.signal);
      operation.assertActive();
      return result;
    } catch (error) {
      operation.assertActive();
      throw error;
    } finally {
      operation.finish();
    }
  }

  async interruptForStorageLoss(): Promise<void> {
    this.storageGeneration += 1;
    this.discoveredModels.clear();
    for (const controller of this.activeProviderOperations) {
      controller.abort(providerOperationAbortError());
    }
    this.activeProviderOperations.clear();
  }

  async *stream(
    providerId: string,
    request: ModelRequest,
  ): AsyncIterable<ModelEvent> {
    yield* (await this.resolveProvider(providerId)).stream(request);
  }

  async deleteProvider(providerId: string): Promise<void> {
    if (this.isProviderInUse(providerId)) {
      throw new Error("该模型正在被正在运行的任务使用，无法删除。");
    }
    const config = this.requireConfig(providerId);
    this.providers.remove(providerId);
    await this.secrets.remove(config.secretRef);
  }

  private requireConfig(providerId: string): ProviderConfig {
    const config = this.providers.get(providerId);
    if (config === null) {
      throw new Error(`模型配置 ${providerId} 不存在`);
    }
    return config;
  }

  private assertProviderExecutionConfigurationMutable(
    providerId: string,
    executionConfigurationChanged: boolean,
  ): void {
    if (
      executionConfigurationChanged &&
      this.isProviderInUse(providerId)
    ) {
      throw new Error(
        "该模型仍被可继续或可重试的任务引用，无法修改执行配置。",
      );
    }
  }

  private assertDiscoveryAuthorized(input: {
    baseUrl: string;
    apiKey: string;
    headers: Record<string, string>;
    modelId: string;
  }, required = requiresAuthenticatedDiscovery(input.baseUrl)): void {
    if (!required) {
      return;
    }
    const discovered = this.discoveredModels.get(
      discoveryFingerprint(input),
    );
    if (discovered?.has(input.modelId) !== true) {
      throw new Error(
        "此服务商必须先使用相同 API Key 和请求配置发现并选择模型。",
      );
    }
  }

  private async resolveProvider(
    providerId: string,
  ): Promise<OpenAiCompatibleProvider> {
    const config = this.requireConfig(providerId);
    assertProviderSecurity(config);
    const apiKey = await this.secrets.get(config.secretRef);
    if (apiKey === null) {
      throw new Error("模型 API Key 不存在");
    }
    return new OpenAiCompatibleProvider(config, apiKey, this.fetchImpl);
  }

  private beginProviderOperation(
    externalSignal?: AbortSignal,
  ): ProviderOperation {
    const controller = new AbortController();
    const generation = this.storageGeneration;
    const forwardExternalAbort = () => {
      controller.abort(providerOperationAbortError());
    };
    if (externalSignal?.aborted === true) {
      forwardExternalAbort();
    } else {
      externalSignal?.addEventListener("abort", forwardExternalAbort, {
        once: true,
      });
    }
    this.activeProviderOperations.add(controller);

    return {
      signal: controller.signal,
      assertActive: () => {
        if (
          generation !== this.storageGeneration ||
          controller.signal.aborted
        ) {
          throw providerOperationAbortError();
        }
      },
      finish: () => {
        externalSignal?.removeEventListener("abort", forwardExternalAbort);
        this.activeProviderOperations.delete(controller);
      },
    };
  }
}
