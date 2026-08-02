import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/main/persistence/database";
import { ModelRoutingRepository } from "../../src/main/persistence/modelRoutingRepository";
import { ProviderRepository } from "../../src/main/persistence/providerRepository";
import type { ProviderConfig } from "../../src/shared/domain";

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider-1",
    name: "Team model",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    modelId: "team-code",
    contextLength: 128_000,
    headers: {},
    secretRef: "provider/provider-1",
    keySuffix: "1234",
    isDefault: false,
    connectionStatus: "untested",
    connectionMessage: null,
    lastTestedAt: null,
    billingNote: "计费规则由服务商决定",
    dashboardUrl: "",
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function harness() {
  const database = openDatabase(":memory:");
  const providers = new ProviderRepository(database);
  const routing = new ModelRoutingRepository(database);
  return { database, providers, routing };
}

describe("ModelRoutingRepository", () => {
  it("bootstraps only the named Groq and KIMI K3 provider roles", () => {
    const { database, providers, routing } = harness();
    const generic = provider();
    const groq = provider({ id: "groq", name: "gRoQ" });
    const kimi = provider({
      id: "kimi-k3",
      name: "KIMI K3",
      kind: "kimi",
      modelId: "kimi-k3",
    });
    providers.create(generic);
    providers.create(groq);
    providers.create(kimi);

    expect(routing.bootstrap(providers.list(), 200)).toEqual({
      lightProviderId: "groq",
      premiumProviderId: "kimi-k3",
      updatedAt: 200,
    });

    database.close();
  });

  it("selects only normalized exact Groq and KIMI K3 names", () => {
    const { database, providers, routing } = harness();
    const notGroq = provider({ id: "not-groq", name: "NotGroq" });
    const groqBackup = provider({ id: "groq-backup", name: "Groq Backup" });
    const groq = provider({ id: "groq", name: "  gRoQ  " });
    const kimiK30 = provider({ id: "kimi-k30", name: "KIMI K30", kind: "kimi" });
    const kimiBackup = provider({ id: "kimi-backup", name: "KIMI K3 Backup", kind: "kimi" });
    const kimi = provider({
      id: "kimi-k3",
      name: "\tKIMI   K3\n",
      kind: "kimi",
    });
    providers.create(notGroq);
    providers.create(groqBackup);
    providers.create(groq);
    providers.create(kimiK30);
    providers.create(kimiBackup);
    providers.create(kimi);

    expect(routing.bootstrap(providers.list(), 200)).toEqual({
      lightProviderId: groq.id,
      premiumProviderId: kimi.id,
      updatedAt: 200,
    });

    database.close();
  });

  it("leaves missing roles null and never guesses a generic custom provider", () => {
    const { database, providers, routing } = harness();
    providers.create(provider({ id: "custom", name: "My fast model" }));

    expect(routing.bootstrap(providers.list(), 200)).toEqual({
      lightProviderId: null,
      premiumProviderId: null,
      updatedAt: 200,
    });

    database.close();
  });

  it("does not assign a KIMI K3-named provider unless it has the kimi kind", () => {
    const { database, providers, routing } = harness();
    providers.create(provider({
      id: "wrong-kind",
      name: "KIMI K3",
      kind: "openai-compatible",
    }));

    expect(routing.bootstrap(providers.list(), 200)).toEqual({
      lightProviderId: null,
      premiumProviderId: null,
      updatedAt: 200,
    });

    database.close();
  });

  it("preserves user-selected roles during later bootstrap calls", () => {
    const { database, providers, routing } = harness();
    const custom = provider({ id: "custom", name: "My chosen model" });
    const groq = provider({ id: "groq", name: "Groq" });
    providers.create(custom);
    providers.create(groq);

    routing.update({ lightProviderId: "custom", premiumProviderId: null }, 100);

    expect(routing.bootstrap(providers.list(), 200)).toEqual({
      lightProviderId: "custom",
      premiumProviderId: null,
      updatedAt: 100,
    });

    database.close();
  });

  it("requires existing provider IDs when updating a role", () => {
    const { database, routing } = harness();

    expect(() =>
      routing.update({ lightProviderId: "missing", premiumProviderId: null }, 200),
    ).toThrow("Provider missing does not exist");

    database.close();
  });

  it("keeps assigned providers from being deleted until their role changes", () => {
    const { database, providers, routing } = harness();
    const groq = provider({ id: "groq", name: "Groq" });
    providers.create(groq);
    routing.update({ lightProviderId: groq.id, premiumProviderId: null }, 200);

    expect(() => providers.remove(groq.id)).toThrow();

    routing.update({ lightProviderId: null, premiumProviderId: null }, 300);
    expect(() => providers.remove(groq.id)).not.toThrow();

    database.close();
  });
});
