import type { StorageStatus } from "../shared/ipc";

type StorageStatusEventListener = (
  event: unknown,
  status: StorageStatus,
) => void;

export interface StorageStatusIpc {
  on(channel: string, listener: StorageStatusEventListener): void;
  removeListener(channel: string, listener: StorageStatusEventListener): void;
  send(channel: string): void;
}

export function subscribeStorageStatus(
  ipc: StorageStatusIpc,
  listener: (status: StorageStatus) => void,
): () => void {
  let lastGeneration = -1;
  const onStatus: StorageStatusEventListener = (_event, status) => {
    if (status.generation <= lastGeneration) return;
    lastGeneration = status.generation;
    listener(status);
  };
  ipc.on("zoro:app:storage-status", onStatus);
  ipc.send("zoro:app:storage-status:subscribe");
  return () => {
    ipc.removeListener("zoro:app:storage-status", onStatus);
    ipc.send("zoro:app:storage-status:unsubscribe");
  };
}
