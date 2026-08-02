export function resolveE2eMode(
  requested: boolean,
  isPackaged: boolean,
): boolean {
  return requested && !isPackaged;
}

export function resolveDevelopmentPortableRoot(
  isPackaged: boolean,
  requestedRoot: string | undefined,
): string | undefined {
  return isPackaged ? undefined : requestedRoot;
}

export function resolveE2eStartupDelay(
  isE2e: boolean,
  requestedDelay: string | undefined,
): number {
  if (
    !isE2e ||
    requestedDelay === undefined ||
    !/^\d+$/.test(requestedDelay)
  ) {
    return 0;
  }
  const delay = Number(requestedDelay);
  return Number.isSafeInteger(delay) && delay <= 10_000 ? delay : 0;
}
