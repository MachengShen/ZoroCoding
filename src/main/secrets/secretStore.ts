import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { allowWrites, type LiveWriteGate } from "../persistence/liveWriteGate";

export interface SecretCrypto {
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface SecretStoreHooks {
  afterMkdir?: () => Promise<void>;
  afterWrite?: () => Promise<void>;
  afterChmod?: () => Promise<void>;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export class SecretStore {
  constructor(
    private readonly directory: string,
    private readonly crypto: SecretCrypto,
    private readonly writeGate: LiveWriteGate = allowWrites,
    private readonly hooks: SecretStoreHooks = {},
  ) {}

  async put(reference: string, value: string): Promise<void> {
    this.writeGate.assertWritable();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.hooks.afterMkdir?.();
    this.writeGate.assertWritable();
    const destination = this.pathFor(reference);
    const temporary = path.join(
      this.directory,
      `.${path.basename(destination)}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, this.crypto.encryptString(value), {
        mode: 0o600,
      });
      await this.hooks.afterWrite?.();
      this.writeGate.assertWritable();
      await chmod(temporary, 0o600);
      await this.hooks.afterChmod?.();
      this.writeGate.assertWritable();
      await rename(temporary, destination);
    } catch (error) {
      try {
        this.writeGate.assertWritable();
        await unlink(temporary);
      } catch (cleanupError) {
        if (!isMissingFile(cleanupError)) {
          // Staged secret cleanup is best-effort after storage loss.
        }
      }
      throw error;
    }
  }

  async get(reference: string): Promise<string | null> {
    try {
      const encrypted = await readFile(this.pathFor(reference));
      return this.crypto.decryptString(encrypted);
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  }

  async remove(reference: string): Promise<void> {
    this.writeGate.assertWritable();
    await this.removeInternal(reference);
  }

  async reconcile(references: string[]): Promise<void> {
    this.writeGate.assertWritable();
    const allowed = new Set(references.map((reference) => path.basename(this.pathFor(reference))));
    try {
      for (const entry of await readdir(this.directory)) {
        if (entry.includes(".tmp") || (entry.endsWith(".secret") && !allowed.has(entry))) {
          this.writeGate.assertWritable();
          await unlink(path.join(this.directory, entry));
        }
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  private async removeInternal(reference: string): Promise<void> {
    try {
      await unlink(this.pathFor(reference));
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }

  private pathFor(reference: string): string {
    const digest = createHash("sha256").update(reference).digest("hex");
    return path.join(this.directory, `${digest}.secret`);
  }
}
