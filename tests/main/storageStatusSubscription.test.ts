import { describe, expect, it, vi } from "vitest";

import { subscribeStorageStatus } from "../../src/preload/storageStatusSubscription";
import type { StorageStatus } from "../../src/shared/ipc";

type StorageListener = (event: unknown, status: StorageStatus) => void;

class FakeStorageIpc {
  readonly listeners = new Set<StorageListener>();
  readonly sent: string[] = [];

  on(_channel: string, listener: StorageListener): void {
    this.listeners.add(listener);
  }

  removeListener(_channel: string, listener: StorageListener): void {
    this.listeners.delete(listener);
  }

  send(channel: string): void {
    this.sent.push(channel);
  }

  emit(status: StorageStatus): void {
    for (const listener of [...this.listeners]) {
      listener({}, status);
    }
  }
}

describe("subscribeStorageStatus", () => {
  it("monotonic storage status listener emits generations 4 and 5 for input 4 4 3 5", () => {
    const ipc = new FakeStorageIpc();
    const delivered = vi.fn();
    const cleanup = subscribeStorageStatus(ipc, delivered);

    ipc.emit({
      storageAvailable: true,
      restartRequired: false,
      generation: 4,
    });
    ipc.emit({
      storageAvailable: false,
      restartRequired: true,
      generation: 4,
    });
    ipc.emit({
      storageAvailable: false,
      restartRequired: true,
      generation: 3,
    });
    ipc.emit({
      storageAvailable: true,
      restartRequired: false,
      generation: 5,
    });

    expect(delivered.mock.calls.map(([status]) => status.generation)).toEqual([
      4, 5,
    ]);
    cleanup();
  });

  it("monotonic storage status listener stops delivery after cleanup through the preload bridge contract", () => {
    const ipc = new FakeStorageIpc();
    const delivered = vi.fn();
    const cleanup = subscribeStorageStatus(ipc, delivered);
    ipc.emit({
      storageAvailable: false,
      restartRequired: true,
      generation: 4,
    });

    cleanup();
    ipc.emit({
      storageAvailable: true,
      restartRequired: false,
      generation: 5,
    });

    expect(delivered).toHaveBeenCalledOnce();
    expect(ipc.listeners.size).toBe(0);
    expect(ipc.sent).toEqual([
      "zoro:app:storage-status:subscribe",
      "zoro:app:storage-status:unsubscribe",
    ]);
  });
});
