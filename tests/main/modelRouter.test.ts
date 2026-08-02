import { describe, expect, it } from "vitest";

import { ModelRouter } from "../../src/main/routing/modelRouter";
import type { ModelRoutingConfig } from "../../src/main/persistence/modelRoutingRepository";
import type { ProviderConfig, ProviderSnapshot } from "../../src/shared/domain";

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "groq",
    name: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    modelId: "qwen/qwen3.6-27b",
    contextLength: 131_072,
    headers: {},
    secretRef: "provider/groq",
    keySuffix: "1234",
    isDefault: false,
    connectionStatus: "untested",
    connectionMessage: null,
    lastTestedAt: null,
    billingNote: "免费额度",
    dashboardUrl: "https://console.groq.com/keys",
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function routerFor(input: {
  config: ModelRoutingConfig | null;
  providers: ProviderConfig[];
}): ModelRouter {
  return new ModelRouter(
    { get: () => input.config },
    {
      getProviderSnapshot: (id: string) => {
        const configured = input.providers.find((provider) => provider.id === id);
        return configured === undefined ? null : {
          providerId: configured.id,
          name: configured.name,
          kind: configured.kind,
          baseUrl: configured.baseUrl,
          modelId: configured.modelId,
          contextLength: configured.contextLength,
        } satisfies ProviderSnapshot;
      },
    },
  );
}

describe("ModelRouter", () => {
  it("uses the configured light provider for a read-only automatic route", () => {
    const groq = provider();
    const router = routerFor({
      config: { lightProviderId: groq.id, premiumProviderId: null, updatedAt: 100 },
      providers: [groq],
    });

    expect(router.resolve({
      prompt: "翻译成英文",
      selection: { mode: "auto" },
    })).toMatchObject({
      decision: { lane: "light", executionMode: "read_only" },
      selectionMode: "auto",
      provider: { providerId: groq.id },
    });
  });

  it("keeps the classifier's agentic mode when a manual provider is selected", () => {
    const groq = provider();
    const router = routerFor({
      config: { lightProviderId: groq.id, premiumProviderId: null, updatedAt: 100 },
      providers: [groq],
    });

    expect(router.resolve({
      prompt: "修复并运行测试",
      selection: { mode: "manual", providerId: groq.id },
    })).toMatchObject({
      decision: { lane: "premium", executionMode: "agentic" },
      selectionMode: "manual",
      provider: { providerId: groq.id },
    });
  });

  it("returns only a provider snapshot without secret-bearing configuration", () => {
    const groq = provider({
      headers: { "X-Provider-Header": "private" },
      secretRef: "provider/groq/private-version",
      keySuffix: "secret",
      connectionStatus: "connected",
      connectionMessage: "internal health detail",
      lastTestedAt: 200,
    });
    const router = routerFor({
      config: { lightProviderId: groq.id, premiumProviderId: null, updatedAt: 100 },
      providers: [groq],
    });

    const route = router.resolve({
      prompt: "翻译成英文",
      selection: { mode: "auto" },
    });

    expect(route.provider).toEqual({
      providerId: groq.id,
      name: groq.name,
      kind: groq.kind,
      baseUrl: groq.baseUrl,
      modelId: groq.modelId,
      contextLength: groq.contextLength,
    });
    expect(route.provider).not.toHaveProperty("secretRef");
    expect(route.provider).not.toHaveProperty("headers");
    expect(route.provider).not.toHaveProperty("keySuffix");
    expect(route.provider).not.toHaveProperty("connectionStatus");
  });

  it("throws when the automatic lane is not configured instead of falling back", () => {
    const premium = provider({ id: "kimi-k3", name: "KIMI K3", kind: "kimi" });
    const router = routerFor({
      config: { lightProviderId: null, premiumProviderId: premium.id, updatedAt: 100 },
      providers: [premium],
    });

    expect(() => router.resolve({
      prompt: "翻译成英文",
      selection: { mode: "auto" },
    })).toThrow("No provider is configured for the light lane");
  });

  it("throws when a manually selected provider no longer exists", () => {
    const router = routerFor({
      config: null,
      providers: [],
    });

    expect(() => router.resolve({
      prompt: "翻译成英文",
      selection: { mode: "manual", providerId: "deleted" },
    })).toThrow("Manual provider deleted does not exist");
  });
});
