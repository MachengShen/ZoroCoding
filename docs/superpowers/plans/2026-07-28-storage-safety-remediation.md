# ZoroCoding Storage Safety Remediation

## Goal

Close the executable-proof gaps left by the portable-storage interruption work so Task 4 can be accepted before provider and release work continues.

## Global Constraints

- Work only in the existing `feature/zorocoding-mvp` worktree.
- Do not read, write, print, or hard-code any real API key.
- Preserve fail-closed portable storage, the canonical `Projects` boundary, versioned provider secret references, and the no-write-after-loss gate.
- Use TDD: every new regression must be observed failing for the intended reason before production changes.
- Do not install or replace `/Volumes/ORICO/ZoroCoding.app`.
- Keep the change focused on tests and the minimum testability/lifecycle code required by those tests.

### Task 1: Complete Storage Safety Evidence

**Files:**
- Modify: `tests/main/modelGateway.test.ts`
- Modify: `tests/main/ipc.test.ts`
- Create: `src/preload/storageStatusSubscription.ts`
- Modify: `src/preload/index.ts`
- Create: `tests/main/storageStatusSubscription.test.ts`
- Modify only if a failing test requires it: `src/main/ipc/registerIpc.ts`
- Modify only if a failing test requires it: `src/main/secrets/secretStore.ts`

**Required executable tests:**

1. `reconcile removes unreferenced final and temporary secrets while preserving referenced secrets`.
2. `reconcile surfaces an unlink failure instead of continuing startup`.
3. `successful key rotation with cleanup blocked leaves the old ref as a safe orphan and restart reconciliation removes it`.
4. `successful provider deletion removes the captured current versioned secret ref`.
5. `unregistering and re-registering IPC leaves exactly one current storage replay listener`.
6. `storage replay contains exactly storageAvailable restartRequired and generation and never uses a stale closure`.
7. `monotonic storage status listener emits generations 4 and 5 for input 4 4 3 5`.
8. `monotonic storage status listener stops delivery after cleanup through the preload bridge contract`.

**Implementation decisions:**

- Use an EventEmitter/Set-style IPC fake capable of retaining duplicate listeners; a single-callback `Map` is not sufficient evidence.
- The production Electron adapter must register and remove the same callback object.
- Factor generation filtering into a pure preload helper so it is executable under Vitest without importing Electron.
- Reconciliation must use the normal live write gate, preserve referenced secret files, remove identifiable orphan/staging files, and propagate cleanup errors.
- Tests must capture the actual versioned `secretRef`; legacy deterministic paths are invalid evidence.

**Verification:**

- Run targeted model gateway, IPC, storage-status helper, storage monitor, file tool, tool registry, and agent runtime tests.
- Run `npm test`.
- Run `npm run build:main`.
- Run `npm run build:renderer`.
- Run `git diff --check`.

**Commit:**

```bash
git add src/preload/storageStatusSubscription.ts src/preload/index.ts src/main/ipc/registerIpc.ts src/main/secrets/secretStore.ts tests/main/modelGateway.test.ts tests/main/ipc.test.ts tests/main/storageStatusSubscription.test.ts
git commit -m "test: complete portable storage safety evidence"
```
