import {
  providerConfigSchema,
  type ProviderConfig,
  type ProviderConnectionStatus,
} from "../../shared/domain";
import { z } from "zod";
import type { ZoroDatabase } from "./database";
import { allowWrites, type LiveWriteGate } from "./liveWriteGate";

interface ProviderRow {
  id: string;
  name: string;
  kind: ProviderConfig["kind"];
  base_url: string;
  model_id: string;
  context_length: number;
  headers_json: string;
  secret_ref: string;
  key_suffix: string;
  is_default: 0 | 1;
  connection_status: ProviderConnectionStatus;
  connection_message: string | null;
  last_tested_at: number | null;
  billing_note: string;
  dashboard_url: string;
  created_at: number;
  updated_at: number;
}

function hydrateProvider(row: ProviderRow): ProviderConfig {
  return providerConfigSchema.parse({
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.base_url,
    modelId: row.model_id,
    contextLength: row.context_length,
    headers: JSON.parse(row.headers_json) as unknown,
    secretRef: row.secret_ref,
    keySuffix: row.key_suffix,
    isDefault: row.is_default === 1,
    connectionStatus: row.connection_status,
    connectionMessage: row.connection_message,
    lastTestedAt: row.last_tested_at,
    billingNote: row.billing_note,
    dashboardUrl: row.dashboard_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) as ProviderConfig;
}

const providerHealthSchema = z
  .object({
    connectionStatus: z.enum(["untested", "connected", "error"]),
    connectionMessage: z.string().nullable(),
    lastTestedAt: z.number().nullable(),
  })
  .strict();

export type ProviderHealth = z.infer<typeof providerHealthSchema>;

export class ProviderRepository {
  constructor(private readonly database: ZoroDatabase, private readonly writeGate: LiveWriteGate = allowWrites) {}

  create(config: ProviderConfig): ProviderConfig {
    this.writeGate.assertWritable();
    const parsed = providerConfigSchema.parse(config) as ProviderConfig;
    this.database.transaction(() => {
      if (parsed.isDefault) {
        this.database.prepare("UPDATE providers SET is_default = 0").run();
      }
      this.database
        .prepare(
          `INSERT INTO providers(
            id, name, kind, base_url, model_id, context_length, headers_json,
            secret_ref, key_suffix, is_default, connection_status,
            connection_message, last_tested_at, billing_note, dashboard_url,
            created_at, updated_at
          ) VALUES (
            @id, @name, @kind, @baseUrl, @modelId, @contextLength,
            @headersJson, @secretRef, @keySuffix, @isDefault,
            @connectionStatus, @connectionMessage, @lastTestedAt,
            @billingNote, @dashboardUrl,
            @createdAt, @updatedAt
          )`,
        )
        .run({
          ...parsed,
          headersJson: JSON.stringify(parsed.headers),
          isDefault: parsed.isDefault ? 1 : 0,
        });
    })();
    return parsed;
  }

  update(id: string, config: ProviderConfig): ProviderConfig {
    this.writeGate.assertWritable();
    if (id !== config.id) {
      throw new Error("Provider ID cannot be changed");
    }
    const parsed = providerConfigSchema.parse(config) as ProviderConfig;
    this.database.transaction(() => {
      if (parsed.isDefault) {
        this.database
          .prepare("UPDATE providers SET is_default = 0 WHERE id <> ?")
          .run(id);
      }
      const result = this.database
        .prepare(
          `UPDATE providers SET
            name = @name,
            kind = @kind,
            base_url = @baseUrl,
            model_id = @modelId,
            context_length = @contextLength,
            headers_json = @headersJson,
            secret_ref = @secretRef,
            key_suffix = @keySuffix,
            is_default = @isDefault,
            connection_status = @connectionStatus,
            connection_message = @connectionMessage,
            last_tested_at = @lastTestedAt,
            billing_note = @billingNote,
            dashboard_url = @dashboardUrl,
            updated_at = @updatedAt
           WHERE id = @id`,
        )
        .run({
          ...parsed,
          headersJson: JSON.stringify(parsed.headers),
          isDefault: parsed.isDefault ? 1 : 0,
        });
      if (result.changes !== 1) {
        throw new Error(`Provider ${id} does not exist`);
      }
    })();
    return parsed;
  }

  get(id: string): ProviderConfig | null {
    const row = this.database
      .prepare("SELECT * FROM providers WHERE id = ?")
      .get(id) as ProviderRow | undefined;
    return row === undefined ? null : hydrateProvider(row);
  }

  list(): ProviderConfig[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM providers ORDER BY is_default DESC, created_at ASC",
      )
      .all() as ProviderRow[];
    return rows.map(hydrateProvider);
  }

  setDefault(id: string, updatedAt: number): void {
    this.writeGate.assertWritable();
    this.database.transaction(() => {
      const exists = this.database
        .prepare("SELECT 1 FROM providers WHERE id = ?")
        .get(id);
      if (exists === undefined) {
        throw new Error(`Provider ${id} does not exist`);
      }
      this.database.prepare("UPDATE providers SET is_default = 0").run();
      this.database
        .prepare(
          "UPDATE providers SET is_default = 1, updated_at = ? WHERE id = ?",
        )
        .run(updatedAt, id);
    })();
  }

  updateHealth(id: string, health: ProviderHealth): ProviderConfig {
    this.writeGate.assertWritable();
    const parsed = providerHealthSchema.parse(health);
    const result = this.database
      .prepare(
        `UPDATE providers SET
          connection_status = @connectionStatus,
          connection_message = @connectionMessage,
          last_tested_at = @lastTestedAt
         WHERE id = @id`,
      )
      .run({ id, ...parsed });
    if (result.changes !== 1) {
      throw new Error(`Provider ${id} does not exist`);
    }
    return this.get(id)!;
  }

  remove(id: string): void {
    this.writeGate.assertWritable();
    const result = this.database
      .prepare("DELETE FROM providers WHERE id = ?")
      .run(id);
    if (result.changes !== 1) {
      throw new Error(`Provider ${id} does not exist`);
    }
  }
}
