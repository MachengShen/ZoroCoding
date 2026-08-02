import type { ProviderConfig, ProviderKind } from "../../shared/domain";
import type { ZoroDatabase } from "./database";
import { allowWrites, type LiveWriteGate } from "./liveWriteGate";

const GROQ_IDENTITY = "groq";
const KIMI_K3_IDENTITY = "kimi k3";

export interface ModelRoutingConfig {
  lightProviderId: string | null;
  premiumProviderId: string | null;
  updatedAt: number;
}

type ProviderIdentity = Pick<ProviderConfig, "id" | "name" | "kind">;

interface ModelRoutingRow {
  light_provider_id: string | null;
  premium_provider_id: string | null;
  updated_at: number;
}

function hydrateConfig(row: ModelRoutingRow): ModelRoutingConfig {
  return {
    lightProviderId: row.light_provider_id,
    premiumProviderId: row.premium_provider_id,
    updatedAt: row.updated_at,
  };
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasIdentity(name: string, identity: string): boolean {
  return normalizeName(name) === normalizeName(identity);
}

function isNamedProvider(
  provider: ProviderIdentity,
  kind: ProviderKind | undefined,
  identity: string,
): boolean {
  return (
    (kind === undefined || provider.kind === kind) &&
    hasIdentity(provider.name, identity)
  );
}

export class ModelRoutingRepository {
  constructor(
    private readonly database: ZoroDatabase,
    private readonly writeGate: LiveWriteGate = allowWrites,
  ) {}

  get(): ModelRoutingConfig | null {
    const row = this.database
      .prepare(
        `SELECT light_provider_id, premium_provider_id, updated_at
         FROM model_routing_config WHERE id = 1`,
      )
      .get() as ModelRoutingRow | undefined;
    return row === undefined ? null : hydrateConfig(row);
  }

  bootstrap(
    providers: readonly ProviderIdentity[],
    now: number,
  ): ModelRoutingConfig {
    const current = this.get();
    const lightProviderId =
      current?.lightProviderId ??
      providers.find((provider) =>
        isNamedProvider(provider, undefined, GROQ_IDENTITY),
      )?.id ??
      null;
    const premiumProviderId =
      current?.premiumProviderId ??
      providers.find((provider) =>
        isNamedProvider(provider, "kimi", KIMI_K3_IDENTITY),
      )?.id ??
      null;

    if (
      current !== null &&
      current.lightProviderId === lightProviderId &&
      current.premiumProviderId === premiumProviderId
    ) {
      return current;
    }

    this.writeGate.assertWritable();
    this.database
      .prepare(
        `INSERT INTO model_routing_config(
          id, light_provider_id, premium_provider_id, updated_at
        ) VALUES (1, @lightProviderId, @premiumProviderId, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          light_provider_id = excluded.light_provider_id,
          premium_provider_id = excluded.premium_provider_id,
          updated_at = excluded.updated_at`,
      )
      .run({ lightProviderId, premiumProviderId, updatedAt: now });
    return { lightProviderId, premiumProviderId, updatedAt: now };
  }

  update(
    input: Pick<ModelRoutingConfig, "lightProviderId" | "premiumProviderId">,
    now: number,
  ): ModelRoutingConfig {
    this.writeGate.assertWritable();
    this.assertProviderExists(input.lightProviderId);
    this.assertProviderExists(input.premiumProviderId);
    this.database
      .prepare(
        `INSERT INTO model_routing_config(
          id, light_provider_id, premium_provider_id, updated_at
        ) VALUES (1, @lightProviderId, @premiumProviderId, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          light_provider_id = excluded.light_provider_id,
          premium_provider_id = excluded.premium_provider_id,
          updated_at = excluded.updated_at`,
      )
      .run({ ...input, updatedAt: now });
    return { ...input, updatedAt: now };
  }

  private assertProviderExists(providerId: string | null): void {
    if (providerId === null) return;
    const exists = this.database
      .prepare("SELECT 1 FROM providers WHERE id = ?")
      .get(providerId);
    if (exists === undefined) {
      throw new Error(`Provider ${providerId} does not exist`);
    }
  }
}
