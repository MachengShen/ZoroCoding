import type { ZoroApi } from "../shared/ipc";

declare global {
  interface Window {
    zoro: ZoroApi;
  }
}

export {};
