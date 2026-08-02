# Strict Sandboxed Preload Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the packaged Electron preload provably strict-mode, preserve the sandbox, reject non-strict release bundles, and complete live ORICO acceptance before any private API key is entered.

**Architecture:** Keep the existing single-file CommonJS preload and all Electron isolation settings. Add `"use strict"` as a generated bundle directive, require that directive through the existing TypeScript-AST release gate, and prove that strict mode blocks `function.caller.arguments` recovery of the CommonJS wrapper. After source and release review pass, install the exact reviewed app on ORICO, verify the real renderer and preload in the live GUI, then enroll providers only through password fields.

**Tech Stack:** Electron 43, Vite 8/Rollup, TypeScript 7 AST APIs, Vitest, Playwright release tests, macOS codesign/hdiutil, Computer Use for Finder and ZoroCoding UI.

## Global Constraints

- Keep `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- The only permitted preload dependency load is a direct, non-optional `require("electron")`.
- Packaged renderer assets must remain relative to `dist-renderer/index.html`.
- Packaged preload output must remain exactly `dist-electron/preload/index.js`.
- Do not access `/Volumes/ORICO` until Task 1 implementation and independent review pass.
- Do not read, print, copy to clipboard, place in shell commands, or write to source any real API key.
- Provider credentials may be entered only into ZoroCoding password fields after a fresh action-time user confirmation.
- Kimi K3 is the default provider; do not enable automatic failover.
- Preserve `/Volumes/ORICO/ZoroCoding 0.1.0 Backup.app`.
- Keep application data and projects fixed at `/Volumes/ORICO/ZoroCodingData/AppData` and `/Volumes/ORICO/ZoroCodingData/Projects`; never fall back to the internal disk.
- Keep application version `0.2.0`, architecture `arm64`, and bundle identifier `com.zorocoding.desktop`.
- The local build remains ad-hoc signed and not notarized; report this limitation without weakening Gatekeeper or sandbox settings.

---

### Task 1: Strict-mode preload build and release gate

**Files:**
- Modify: `vite.preload.config.ts`
- Modify: `scripts/validate-preload.mjs`
- Modify: `tests/main/preloadBuild.test.ts`
- Modify: `tests/e2e/app.spec.ts`
- Create: `.superpowers/sdd/2026-07-28-strict-preload-remediation/task-1-report.md`

**Interfaces:**
- Consumes: `scripts/create-dmg.sh --validate-preload <preload-directory>` and the existing single-file Vite preload bundle.
- Produces: a CommonJS `dist-electron/preload/index.js` whose directive prologue contains `"use strict"` and which passes the TypeScript-AST release validator.
- Produces: release validation that fails closed when strict mode is missing, even if all dependency loads otherwise appear valid.

- [ ] **Step 1: Add failing release and production-build tests**

In `tests/e2e/app.spec.ts`, change the accepted Electron-only fixture to begin with a strict directive:

```ts
await writeFile(
  join(goodDirectory, "index.js"),
  [
    '"use strict";',
    'const electron = require("electron");',
    'electron.contextBridge.exposeInMainWorld("zoro", Object.freeze({}));',
  ].join("\n"),
);
```

Add a `missing-strict` directory containing the same direct `require("electron")` without the directive and assert that `--validate-preload` exits non-zero with the generic preload failure message.

Add both previously reproduced caller-recovery fixtures without a strict directive:

```ts
{
  name: "caller-arguments-require",
  source:
    '(function inner(){ inner["call" + "er"]["argu" + "ments"][0]("./local-helper"); })();\n',
  runtimeRequests: ["./local-helper"],
},
{
  name: "reflect-caller-arguments-require",
  source:
    '(function inner(){ Reflect.get(inner.caller, "argu" + "ments")[0]("./local-helper"); })();\n',
  runtimeRequests: ["./local-helper"],
},
```

Add a VM assertion using the same fake CommonJS wrapper that prepends `"use strict";` to each caller fixture, records zero requested modules, and receives a `TypeError`. This proves the runtime mechanism instead of relying only on text or AST matching.

In `tests/main/preloadBuild.test.ts`, after reading the real production bundle, parse it with TypeScript and assert its directive prologue contains a string-literal expression equal to `"use strict"`. Keep the existing call to the shared release gate and the fake Electron execution that verifies `exposeInMainWorld("zoro", api)`, `app.info()`, and storage generation behavior.

- [ ] **Step 2: Run the new tests and record the red evidence**

Run:

```bash
npx playwright test tests/e2e/app.spec.ts --grep "release preload gate rejects local module loading"
npm test -- tests/main/preloadBuild.test.ts
```

Expected before implementation:

- the missing-strict Electron-only fixture is incorrectly accepted, or
- the real production preload lacks a `"use strict"` directive,
- while both caller fixtures still demonstrate a local-module request in a non-strict wrapper.

Record only test names, exit codes, and safe error summaries in the task report. Do not include source credentials or environment values.

- [ ] **Step 3: Emit strict mode from the real Vite preload build**

In `vite.preload.config.ts`, keep `electron` external and add a Rollup output intro:

```ts
rollupOptions: {
  external: ["electron"],
  output: {
    intro: '"use strict";',
  },
},
```

Do not post-process `dist-electron/preload/index.js`, and do not change Electron window security options. The strict directive must be generated by the same production bundle configuration used by `npm run build` and `npm run package:mac`.

- [ ] **Step 4: Require a strict directive prologue in the AST validator**

In `scripts/validate-preload.mjs`, after obtaining a syntax-clean `sourceFile`, verify the directive prologue before walking dependency nodes:

```js
function hasUseStrictDirective(sourceFile, ast) {
  for (const statement of sourceFile.statements) {
    if (
      !ast.isExpressionStatement(statement) ||
      !ast.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === "use strict") {
      return true;
    }
  }
  return false;
}
```

If the directive is missing, call the existing generic `fail(preloadPath)` path and stop. Keep the current restrictions for imports, `import.meta`, direct `require("electron")`, dynamic execution identifiers, CommonJS wrapper identifiers, `this`, syntax errors, missing compiler dependencies, and the strict one-file directory layout.

- [ ] **Step 5: Run focused green verification**

Run:

```bash
npx playwright test tests/e2e/app.spec.ts --grep "preload gate|preload validator"
npm test -- tests/main/preloadBuild.test.ts
npm run build
```

Expected:

- all preload gate and dependency-missing tests pass,
- the non-strict caller fixtures are rejected,
- strict-mode VM executions cannot request `./local-helper`,
- `dist-electron/preload/index.js` begins with a valid strict directive,
- the production bundle requests only `electron` and exposes the frozen `zoro` API.

- [ ] **Step 6: Run full source and release verification**

Run:

```bash
npm test
npm test -- tests/main/fullWorkflow.test.ts
npx playwright test tests/e2e/app.spec.ts --grep "requires the E2E|release packaging|credential fixture|DMG staging|release preload|preload validator|release failures"
npm run package:mac
git diff --check
```

Verify:

- full tests, build, and full workflow pass;
- credential scans cover tracked source, runtime, extracted ASAR, ASAR unpacked files, installation instructions, current release, and archived release;
- `release/ZoroCoding-0.2.0-arm64.dmg.sha256` validates;
- `hdiutil verify` succeeds;
- `codesign --verify --deep --strict` succeeds with the expected ad-hoc signature;
- executable and native bundle architecture are arm64;
- bundle short/build version is `0.2.0`;
- ASAR contains relative renderer assets and exactly one preload file;
- the extracted preload passes the same strict AST gate and fake Electron execution.

- [ ] **Step 7: Commit the reviewed task**

Commit only the strict-mode implementation, tests, and task report:

```bash
git add vite.preload.config.ts scripts/validate-preload.mjs tests/main/preloadBuild.test.ts tests/e2e/app.spec.ts .superpowers/sdd/2026-07-28-strict-preload-remediation/task-1-report.md
git commit -m "fix: enforce strict sandbox preload"
```

Generate an independent review package for the task commit. A reviewer must reproduce the two caller paths in non-strict mode, confirm strict mode blocks them, inspect the AST directive check, and rerun the source and release verification. Do not proceed to Task 2 on `FAIL`.

---

### Task 2: ORICO installation, live GUI gate, and private provider enrollment

**Files:**
- Copy after acceptance: `release/ZoroCoding-0.2.0-arm64.dmg`
- Copy after acceptance: `release/ZoroCoding-0.2.0-arm64.dmg.sha256`
- Create: `outputs/ZoroCoding-0.2.0-安装与验收说明.md`

**Interfaces:**
- Consumes: independently reviewed Task 1 app at `release/mac-arm64/ZoroCoding.app`.
- Consumes: the existing ORICO app/data layout and the recoverable `ZoroCoding 0.1.0 Backup.app`.
- Produces: a live, acceptance-tested `/Volumes/ORICO/ZoroCoding.app`.
- Produces: encrypted provider records with Kimi K3 selected as default and no automatic failover.

- [ ] **Step 1: Verify exact installation source and current ORICO state**

Before any write, verify the local app version, architecture, signature, ASAR hash, relative renderer assets, strict preload directive, and strict preload gate. Read-only inspect:

```text
/Volumes/ORICO/ZoroCoding.app
/Volumes/ORICO/ZoroCoding 0.1.0 Backup.app
/Volumes/ORICO/ZoroCodingData/AppData
/Volumes/ORICO/ZoroCodingData/Projects
```

Confirm the backup remains version `0.1.0`. Confirm ZoroCoding is not running before replacement.

- [ ] **Step 2: Replace only the current 0.2.0 app through Finder**

Use Computer Use with Finder to copy the reviewed `release/mac-arm64/ZoroCoding.app` to `/Volumes/ORICO/ZoroCoding.app` and choose Replace. Do not modify or delete `ZoroCoding 0.1.0 Backup.app` or `ZoroCodingData`.

After copying, verify the installed ASAR SHA-256 equals the reviewed source ASAR, then rerun codesign, architecture, version, renderer asset, and strict preload checks against the installed path.

- [ ] **Step 3: Enforce the live GUI readiness gate**

Launch the exact `/Volumes/ORICO/ZoroCoding.app` path with Computer Use. Require all of the following:

- the ZoroCoding sidebar and workbench render instead of a blank page;
- the Settings view opens;
- the displayed AppData path is `/Volumes/ORICO/ZoroCodingData/AppData`;
- the displayed Projects path is `/Volumes/ORICO/ZoroCodingData/Projects`;
- Developer Tools Console contains no preload-load error, no missing local module error, and no `window.zoro` undefined error;
- closing Developer Tools leaves the main UI responsive.

If any item fails, close the app, stop Task 2, and do not enter credentials.

- [ ] **Step 4: Request fresh action-time confirmation for credential enrollment**

Immediately before typing the first API key, tell the user:

```text
ZoroCoding 0.2.0 已在 ORICO 上通过真实启动与存储路径检查。下一步会把你提供的 Kimi、Groq、Gemini、OpenRouter、Cerebras、SambaNova、Mistral、NVIDIA、智谱 API Key 输入 ZoroCoding 的加密密码字段，并把 Kimi K3 设为默认模型。确认现在录入吗？
```

Do not proceed until the user explicitly confirms this action.

- [ ] **Step 5: Enroll Kimi K3 first and make it default**

Use only ZoroCoding UI fields. Select the Kimi template, enter its dashboard URL/base URL/model information from the built-in template, type the user-supplied key into the password field, run model discovery/connection test, save, and set it as default. Do not copy the key to the clipboard and do not print it.

Confirm the provider list shows only a masked suffix and that Kimi is marked default. Do not configure automatic failover.

- [ ] **Step 6: Enroll the remaining providers**

Through the same UI flow, add Groq, Gemini, OpenRouter, Cerebras, SambaNova, Mistral, NVIDIA, and Zhipu. For each provider:

- choose the matching template;
- type its user-supplied key only into the password field;
- discover/select a supported model when the provider requires discovery;
- run the connection test;
- save only if validation succeeds;
- leave Kimi as default.

If a provider rejects the supplied key or exposes no compatible model, record a masked provider-level failure and continue without changing the default.

- [ ] **Step 7: Verify encrypted persistence without exposing secrets**

Close ZoroCoding, then inspect only metadata:

- database provider rows contain provider IDs, names, base URLs, model IDs, secret references, and masked suffixes, but no plaintext keys;
- the secrets directory contains encrypted blobs;
- no plaintext API-key shape appears in the database, logs, preferences, or source tree;
- all paths remain under `/Volumes/ORICO/ZoroCodingData/AppData`.

Never print file contents that may include secret material.

- [ ] **Step 8: Run the core live acceptance workflow**

Reopen ZoroCoding, authorize a disposable project located under `/Volumes/ORICO/ZoroCodingData/Projects`, create a small task, and verify:

- task submission succeeds using the default Kimi provider;
- progress bar and countdown are visible;
- the agent reads and modifies a project file;
- a terminal command runs only after the expected approval;
- the result and event history are visible;
- generated project files remain on ORICO.

If the provider call fails because of account quota, keep the successful local UI/storage/approval evidence and report the provider response without switching the default automatically.

- [ ] **Step 9: Publish user-facing artifacts**

Copy the verified DMG and SHA file to:

```text
/Users/vion/Documents/Codex/2026-07-28/1-codex-2-zorocoding-3-3/outputs
```

Create `outputs/ZoroCoding-0.2.0-安装与验收说明.md` containing:

- installed and backup paths;
- AppData and Projects paths;
- version, architecture, signing/notarization limitation;
- DMG checksum;
- masked provider status and default provider;
- live workflow result;
- safe launch instructions.

Do not include API keys or secret-file contents.

- [ ] **Step 10: Final verification**

Run fresh:

```bash
npm test
npm run build
npm test -- tests/main/fullWorkflow.test.ts
git diff --check
git status --short
```

Verify output artifact checksums and report any environment-only GUI E2E limitation separately from the completed live ORICO acceptance.
