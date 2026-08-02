# Strict Black-Green Theme Implementation Plan

> Superseded for execution by `docs/superpowers/plans/2026-07-28-routing-quick-chat-black-green.md`, which integrates this theme work with the approved automatic-routing and Quick Chat scope.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every app-controlled ZoroCoding surface to a strict pure-black and fluorescent-green theme, including AI output, terminal output, parsed code changes, dialogs, progress, and the first window frame.

**Architecture:** Keep color ownership centralized in `src/renderer/styles.css` behind two CSS custom properties and enforce the contract with a static Vitest scanner. Add focused output components that expose semantic line and status classes without owning colors, then verify actual computed styles in the existing Electron Playwright workflow. Preserve the preload, IPC, encrypted provider storage, ORICO layout, and task runtime unchanged.

**Tech Stack:** Electron 43, React 19, TypeScript 7, CSS, Vitest 4, Testing Library, Playwright 1.62, electron-builder.

## Global Constraints

- The only app-controlled colors are pure black `#000000` and fluorescent green `#C9FF62`.
- AI output, terminal output, parsed code, and diffs are black backgrounds with green text.
- No RGB, HSL, named colors, gradients, shadows, or opacity-created third colors are allowed in renderer styles.
- Success, warning, error, waiting, disabled, hover, selected, and focus states must remain distinguishable without adding a third color.
- The macOS traffic-light buttons remain OS-controlled; the title-bar area around them must be black.
- Do not change provider configuration, encrypted secret format, preload sandbox, IPC allowlist, task execution, or fixed ORICO paths.
- Preserve all 9 providers, exactly 1 default provider, the `0.1.0` backup app, and `/Volumes/ORICO/ZoroCodingData`.
- Keep package version `0.2.0`, target `arm64`, and retain the existing release gates.

---

## File Map

- Create `tests/renderer/themeContract.test.ts`: static two-color contract for renderer CSS and renderer source.
- Modify `src/renderer/styles.css`: sole renderer color source and all black-green component styling.
- Create `src/renderer/components/CodePatch.tsx`: classify and render patch lines with semantic classes.
- Create `src/renderer/components/TerminalOutput.tsx`: render terminal content with semantic status labels.
- Create `tests/renderer/OutputBlocks.test.tsx`: real rendering tests for parsed patch lines and terminal statuses.
- Modify `src/renderer/components/Workbench.tsx`: use semantic code and terminal output components.
- Modify `src/renderer/components/ProgressPanel.tsx`: use the shared terminal output component in the progress panel.
- Modify `tests/main/createWindow.test.ts`: require a black first-frame window background.
- Modify `src/main/createWindow.ts`: change the BrowserWindow first-frame background to pure black.
- Modify `tests/e2e/app.spec.ts`: verify computed black-green styles across the complete task workflow.
- Update `docs/superpowers/plans/2026-07-28-strict-black-green-theme.md`: check completed steps during execution.
- Update `/Users/vion/Documents/Codex/2026-07-28/1-codex-2-zorocoding-3-3/outputs/ZoroCoding-安装与验收说明.md`: publish the final local handoff outside the worktree.

---

### Task 1: Enforce the Renderer Two-Color Contract

**Files:**
- Create: `tests/renderer/themeContract.test.ts`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: design tokens `#000000` and `#C9FF62`.
- Produces: CSS custom properties `--zoro-black` and `--zoro-green`; every later renderer style must reference these tokens.

- [ ] **Step 1: Write the failing static theme contract**

Create `tests/renderer/themeContract.test.ts` with a real file scan:

```ts
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ALLOWED_HEX = new Set(["#000000", "#c9ff62"]);

async function rendererSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return rendererSourceFiles(path);
      return /\.(css|tsx?|svg)$/i.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

describe("strict black-green theme contract", () => {
  it("allows only the two approved renderer colors", async () => {
    const files = await rendererSourceFiles(resolve("src/renderer"));
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const hexColors = source.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
      for (const value of hexColors) {
        if (!ALLOWED_HEX.has(value.toLowerCase())) {
          violations.push(`${file}: ${value}`);
        }
      }
      if (/\b(?:rgb|rgba|hsl|hsla|linear-gradient|radial-gradient)\s*\(/i.test(source)) {
        violations.push(`${file}: functional color or gradient`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("does not manufacture third colors with transparency or shadows", async () => {
    const css = await readFile(resolve("src/renderer/styles.css"), "utf8");

    expect(css).not.toMatch(/(?<![-\w])transparent(?![-\w])/i);
    expect(css).not.toMatch(
      /(?<![-\w])(?:white|black|red|yellow|blue|gray|grey|green|lime)(?![-\w])/i,
    );
    expect(css).not.toMatch(/\bbox-shadow\s*:/i);
    expect(css).not.toMatch(/\btext-shadow\s*:/i);
    expect(css).not.toMatch(/\bopacity\s*:\s*(?!1(?:\.0+)?\s*[;}])/i);
  });

  it("declares and applies the approved tokens to output surfaces", async () => {
    const css = await readFile(resolve("src/renderer/styles.css"), "utf8");

    expect(css).toContain("--zoro-black: #000000;");
    expect(css).toContain("--zoro-green: #c9ff62;");
    for (const selector of [
      ".terminal-output",
      ".diff-output",
      ".recent-terminal",
      ".modal",
      ".progress-panel",
    ]) {
      expect(css).toContain(selector);
    }
  });
});
```

- [ ] **Step 2: Run the focused test and verify the expected red state**

Run:

```bash
npm test -- tests/renderer/themeContract.test.ts
```

Expected: FAIL listing the existing white, gray, red, yellow, blue, RGB, shadow, and transparent declarations in `src/renderer/styles.css`.

- [ ] **Step 3: Replace the legacy palette with the two approved tokens**

At the top of `src/renderer/styles.css`, replace the existing palette with:

```css
:root {
  --zoro-black: #000000;
  --zoro-green: #c9ff62;
  color: var(--zoro-green);
  background: var(--zoro-black);
  color-scheme: dark;
  font-family:
    Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text",
    sans-serif;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  border-color: var(--zoro-green);
}

::selection {
  color: var(--zoro-black);
  background: var(--zoro-green);
}

html,
body,
#root {
  min-height: 100%;
  color: var(--zoro-green);
  background: var(--zoro-black);
}
```

Apply this property mapping throughout the existing selectors:

| Existing purpose | Required declaration |
| --- | --- |
| Canvas, sidebar, card, panel, table, form, dialog, overlay | `background: var(--zoro-black)` |
| Ordinary text, muted text, status text, icon | `color: var(--zoro-green)` |
| Border, divider, focus ring, progress track | `border-color: var(--zoro-green)` |
| Primary button, selected item, progress fill | green background and black text |
| Secondary button and unselected item | black background and green text |
| Hovered actionable control | green background and black text |
| Disabled actionable control | black background, green text, dashed green border, no opacity |
| Error or destructive surface | black background, green text, double green border |
| Warning or paused surface | black background, green text, dashed green border |
| Waiting surface | black background, green text, dotted green border |

Remove every `box-shadow`, `text-shadow`, gradient, transparent background, and non-`1` opacity declaration. Keep spacing, sizing, layout, responsive breakpoints, animations, and typography unchanged.

Add explicit black-green browser-control styling:

```css
input,
textarea,
select,
button {
  color: var(--zoro-green);
  background: var(--zoro-black);
  caret-color: var(--zoro-green);
}

input::placeholder,
textarea::placeholder {
  color: var(--zoro-green);
}

button:disabled,
input:disabled,
textarea:disabled,
select:disabled {
  color: var(--zoro-green);
  background: var(--zoro-black);
  border-style: dashed;
  cursor: not-allowed;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
  background: var(--zoro-black);
}

::-webkit-scrollbar-thumb {
  background: var(--zoro-green);
  border: 2px solid var(--zoro-black);
}
```

- [ ] **Step 4: Run the contract test and verify green**

Run:

```bash
npm test -- tests/renderer/themeContract.test.ts
```

Expected: PASS with no third-color violations.

- [ ] **Step 5: Run all existing renderer tests**

Run:

```bash
npm test -- tests/renderer
```

Expected: all renderer tests PASS with no warnings.

- [ ] **Step 6: Commit the renderer theme contract**

```bash
git add src/renderer/styles.css tests/renderer/themeContract.test.ts
git commit -m "feat: enforce strict black green renderer theme"
```

---

### Task 2: Add Semantic Code and Terminal Output

**Files:**
- Create: `src/renderer/components/CodePatch.tsx`
- Create: `src/renderer/components/TerminalOutput.tsx`
- Create: `tests/renderer/OutputBlocks.test.tsx`
- Modify: `src/renderer/components/Workbench.tsx`
- Modify: `src/renderer/components/ProgressPanel.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Produces: `classifyPatchLine(line: string): PatchLineKind`.
- Produces: `CodePatch({ patch }: { patch: string })`.
- Produces: `TerminalOutput({ content, status, compact? }: TerminalOutputProps)`.
- Consumes: `--zoro-black` and `--zoro-green` from Task 1.

- [ ] **Step 1: Write failing output component tests**

Create `tests/renderer/OutputBlocks.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  classifyPatchLine,
  CodePatch,
} from "../../src/renderer/components/CodePatch";
import { TerminalOutput } from "../../src/renderer/components/TerminalOutput";

describe("CodePatch", () => {
  it("classifies metadata before additions and deletions", () => {
    expect(classifyPatchLine("+++ b/src/app.ts")).toBe("meta");
    expect(classifyPatchLine("--- a/src/app.ts")).toBe("meta");
    expect(classifyPatchLine("@@ -1 +1 @@")).toBe("meta");
    expect(classifyPatchLine("+const enabled = true;")).toBe("addition");
    expect(classifyPatchLine("-const enabled = false;")).toBe("deletion");
    expect(classifyPatchLine(" unchanged")).toBe("context");
  });

  it("renders every patch line with its semantic class", () => {
    const { container } = render(
      <CodePatch patch={"@@ -1 +1 @@\n-old\n+new\n context"} />,
    );

    expect(container.querySelectorAll(".diff-line")).toHaveLength(4);
    expect(container.querySelector(".diff-meta")).toHaveTextContent("@@ -1 +1 @@");
    expect(container.querySelector(".diff-deletion")).toHaveTextContent("-old");
    expect(container.querySelector(".diff-addition")).toHaveTextContent("+new");
    expect(container.querySelector(".diff-context")).toHaveTextContent("context");
  });
});

describe("TerminalOutput", () => {
  it.each([
    ["success", "✓ 成功"],
    ["error", "✕ 错误"],
    ["live", "… 运行中"],
    ["waiting", "… 等待"],
  ] as const)("labels %s output without relying on color", (status, label) => {
    render(<TerminalOutput content="npm test" status={status} />);

    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText("npm test")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
npm test -- tests/renderer/OutputBlocks.test.tsx
```

Expected: FAIL because `CodePatch.tsx` and `TerminalOutput.tsx` do not exist.

- [ ] **Step 3: Implement the semantic output components**

Create `src/renderer/components/CodePatch.tsx`:

```tsx
export type PatchLineKind = "addition" | "deletion" | "context" | "meta";

export function classifyPatchLine(line: string): PatchLineKind {
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("@@") ||
    line.startsWith("diff ") ||
    line.startsWith("index ")
  ) {
    return "meta";
  }
  if (line.startsWith("+")) return "addition";
  if (line.startsWith("-")) return "deletion";
  return "context";
}

export function CodePatch({ patch }: { patch: string }) {
  return (
    <pre className="diff-output" aria-label="代码修改">
      {patch.split("\n").map((line, index) => {
        const kind = classifyPatchLine(line);
        return (
          <span className={`diff-line diff-${kind}`} key={`${index}-${line}`}>
            {line.length === 0 ? " " : line}
          </span>
        );
      })}
    </pre>
  );
}
```

Create `src/renderer/components/TerminalOutput.tsx`:

```tsx
export type TerminalOutputStatus = "success" | "error" | "live" | "waiting";

const STATUS_LABEL: Record<TerminalOutputStatus, string> = {
  success: "✓ 成功",
  error: "✕ 错误",
  live: "… 运行中",
  waiting: "… 等待",
};

interface TerminalOutputProps {
  content: string;
  status: TerminalOutputStatus;
  compact?: boolean;
}

export function TerminalOutput({
  content,
  status,
  compact = false,
}: TerminalOutputProps) {
  return (
    <section
      className={compact ? "terminal-block compact" : "terminal-block"}
      data-status={status}
      aria-label="终端输出内容"
    >
      <span className="terminal-status">{STATUS_LABEL[status]}</span>
      <pre className="terminal-output">{content}</pre>
    </section>
  );
}
```

- [ ] **Step 4: Integrate the components into both output surfaces**

In `Workbench.tsx`, import both components and replace raw patch/terminal `<pre>` elements:

```tsx
<CodePatch patch={change.patch} />

<TerminalOutput
  content={event.payload.content}
  status={event.payload.ok ? "success" : "error"}
/>

<TerminalOutput content={liveTerminalText} status="live" />
```

In `ProgressPanel.tsx`, derive a semantic status and use the compact variant:

```tsx
const recentTerminalStatus =
  liveTerminal.length > 0
    ? "live"
    : recentTerminal?.type === "tool_completed"
      ? recentTerminal.payload.ok
        ? "success"
        : "error"
      : "waiting";

<TerminalOutput
  compact
  status={recentTerminalStatus}
  content={
    liveTerminal.length > 0
      ? liveTerminal.slice(-240)
      : recentTerminal?.type === "tool_completed"
        ? recentTerminal.payload.content.slice(-240)
        : "等待命令执行…"
  }
/>
```

- [ ] **Step 5: Add black-green output styling**

Append token-only styles to `src/renderer/styles.css`:

```css
.diff-output,
.terminal-block,
.terminal-output {
  color: var(--zoro-green);
  background: var(--zoro-black);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.diff-line {
  display: block;
  padding-inline-start: 10px;
  border-inline-start: 2px solid var(--zoro-green);
}

.diff-deletion {
  border-inline-start-style: double;
}

.diff-context {
  border-inline-start-style: dotted;
}

.diff-meta,
.terminal-block[data-status="error"] {
  border-style: double;
}

.terminal-block[data-status="live"],
.terminal-block[data-status="waiting"] {
  border-style: dotted;
}

.terminal-status {
  display: inline-block;
  color: var(--zoro-black);
  background: var(--zoro-green);
  padding: 2px 8px;
  font-weight: 700;
}
```

- [ ] **Step 6: Run focused and renderer tests**

Run:

```bash
npm test -- tests/renderer/OutputBlocks.test.tsx tests/renderer/themeContract.test.ts tests/renderer/App.test.tsx tests/renderer/ProgressPanel.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit semantic outputs**

```bash
git add src/renderer/components/CodePatch.tsx src/renderer/components/TerminalOutput.tsx src/renderer/components/Workbench.tsx src/renderer/components/ProgressPanel.tsx src/renderer/styles.css tests/renderer/OutputBlocks.test.tsx
git commit -m "feat: render black green semantic outputs"
```

---

### Task 3: Make the First Window Frame Black

**Files:**
- Modify: `tests/main/createWindow.test.ts`
- Modify: `src/main/createWindow.ts`

**Interfaces:**
- Consumes: Electron `BrowserWindowConstructorOptions`.
- Produces: `buildWindowOptions(preload)` with `backgroundColor: "#000000"` and unchanged security options.

- [ ] **Step 1: Change the existing window test first**

Update the approved-dimensions assertion in `tests/main/createWindow.test.ts`:

```ts
expect(options).toMatchObject({
  width: 1360,
  height: 860,
  minWidth: 900,
  minHeight: 620,
  titleBarStyle: "hiddenInset",
  backgroundColor: "#000000",
});
```

Add a separate regression assertion so the intent is explicit:

```ts
it("uses pure black before the renderer is ready", () => {
  expect(buildWindowOptions("/tmp/zoro-preload.js").backgroundColor).toBe(
    "#000000",
  );
});
```

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
npm test -- tests/main/createWindow.test.ts
```

Expected: FAIL because the production option is still `#ffffff`.

- [ ] **Step 3: Implement the black first frame**

In `src/main/createWindow.ts`, change only:

```ts
backgroundColor: "#000000",
```

Do not change `titleBarStyle`, preload, sandbox, context isolation, navigation denial, or permission handlers.

- [ ] **Step 4: Run the main-window and safety tests**

Run:

```bash
npm test -- tests/main/createWindow.test.ts tests/main/windowSafety.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the first-frame fix**

```bash
git add src/main/createWindow.ts tests/main/createWindow.test.ts
git commit -m "feat: start ZoroCoding on a black frame"
```

---

### Task 4: Verify the Complete Black-Green Workflow

**Files:**
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: the existing Electron E2E launch environment and full task fixture.
- Produces: computed-style assertions for canvas, controls, progress, code, and terminal output.

- [ ] **Step 1: Add a computed-style helper and workflow assertions**

Add this helper near the E2E utilities:

```ts
async function expectBlackGreenSurface(
  locator: import("@playwright/test").Locator,
  expected: { color: string; background: string },
): Promise<void> {
  const style = await locator.evaluate((element) => {
    const computed = window.getComputedStyle(element);
    return {
      color: computed.color,
      background: computed.backgroundColor,
    };
  });
  expect(style).toEqual(expected);
}
```

In the full-workflow test, immediately after `firstWindow()`:

```ts
await expectBlackGreenSurface(page.locator("body"), {
  color: "rgb(201, 255, 98)",
  background: "rgb(0, 0, 0)",
});
await expectBlackGreenSurface(page.locator(".sidebar"), {
  color: "rgb(201, 255, 98)",
  background: "rgb(0, 0, 0)",
});
```

After the task completes:

```ts
await expectBlackGreenSurface(page.locator(".progress-panel"), {
  color: "rgb(201, 255, 98)",
  background: "rgb(0, 0, 0)",
});
await expectBlackGreenSurface(page.locator(".terminal-output").first(), {
  color: "rgb(201, 255, 98)",
  background: "rgb(0, 0, 0)",
});
await expectBlackGreenSurface(page.locator(".diff-output").first(), {
  color: "rgb(201, 255, 98)",
  background: "rgb(0, 0, 0)",
});
await expect(page.getByText("✓ 成功").first()).toBeVisible();
```

Open settings and a model dialog, then assert the modal and form controls:

```ts
await page.getByRole("button", { name: "设置与模型" }).click();
await page.getByRole("button", { name: "配置 KIMI K3" }).click();
await expectBlackGreenSurface(page.locator(".modal"), {
  color: "rgb(201, 255, 98)",
  background: "rgb(0, 0, 0)",
});
await expectBlackGreenSurface(page.getByLabel("API Key"), {
  color: "rgb(201, 255, 98)",
  background: "rgb(0, 0, 0)",
});
```

- [ ] **Step 2: Run the E2E test and diagnose only theme-related failures**

Run:

```bash
npm run build
npx playwright test tests/e2e/app.spec.ts --grep "creates a project task"
```

Expected: PASS. If a computed style differs, fix the owning selector in `src/renderer/styles.css` using only the two approved tokens, rerun the theme contract, then rerun this E2E test.

- [ ] **Step 3: Run the complete automated verification**

Run:

```bash
npm test
npm run build
npm run test:e2e
```

Expected:

- all Vitest tests PASS;
- renderer, main, storage, provider, preload, and release tests remain green;
- Electron E2E completes the project task, file edit, terminal command, progress restoration, and black-green assertions;
- no credential value appears in output.

- [ ] **Step 4: Commit E2E coverage and any token-only selector corrections**

```bash
git add tests/e2e/app.spec.ts src/renderer/styles.css
git commit -m "test: verify strict black green workflow"
```

---

### Task 5: Package, Replace, and Live-Accept the ORICO App

**Files:**
- Generated: `release/mac-arm64/ZoroCoding.app`
- Generated: `release/ZoroCoding-0.2.0-arm64.dmg`
- Generated: `release/ZoroCoding-0.2.0-arm64.dmg.sha256`
- Update: `/Users/vion/Documents/Codex/2026-07-28/1-codex-2-zorocoding-3-3/outputs/ZoroCoding-安装与验收说明.md`

**Interfaces:**
- Consumes: reviewed commits from Tasks 1–4.
- Produces: a verified arm64 app on ORICO with the existing encrypted provider data intact.

- [ ] **Step 1: Record pre-install metadata without reading secrets**

Close ZoroCoding and query only:

```bash
sqlite3 'file:/Volumes/ORICO/ZoroCodingData/AppData/zorocoding.sqlite?mode=ro&immutable=1' \
  "SELECT COUNT(*), SUM(is_default), COUNT(DISTINCT secret_ref) FROM providers;"
find '/Volumes/ORICO/ZoroCodingData/AppData/secrets' -type f -name '*.secret' | wc -l
```

Expected:

```text
9|1|9
9
```

- [ ] **Step 2: Build the reviewed release**

Run:

```bash
npm run package:mac
```

Expected:

- app version `0.2.0`;
- architecture `arm64`;
- release gate accepts a single bundled strict preload;
- credential scan and stale-artifact gate pass;
- DMG and SHA-256 sidecar are generated.

- [ ] **Step 3: Verify the release before installation**

Run:

```bash
codesign --verify --deep --strict --verbose=2 release/mac-arm64/ZoroCoding.app
file release/mac-arm64/ZoroCoding.app/Contents/MacOS/ZoroCoding
shasum -a 256 release/mac-arm64/ZoroCoding.app/Contents/Resources/app.asar
shasum -a 256 release/ZoroCoding-0.2.0-arm64.dmg
```

Expected: valid signature, arm64 executable, and stable hashes recorded in the release report.

- [ ] **Step 4: Replace only the current ORICO app**

Using Finder:

1. Copy `release/mac-arm64/ZoroCoding.app`.
2. Paste into `/Volumes/ORICO`.
3. Choose **Replace** for `/Volumes/ORICO/ZoroCoding.app`.
4. Do not modify `/Volumes/ORICO/ZoroCoding 0.1.0 Backup.app`.
5. Do not modify `/Volumes/ORICO/ZoroCodingData`.

- [ ] **Step 5: Verify post-install identity and encrypted provider preservation**

Run read-only checks:

```bash
shasum -a 256 \
  release/mac-arm64/ZoroCoding.app/Contents/Resources/app.asar \
  /Volumes/ORICO/ZoroCoding.app/Contents/Resources/app.asar
sqlite3 'file:/Volumes/ORICO/ZoroCodingData/AppData/zorocoding.sqlite?mode=ro&immutable=1' \
  "SELECT COUNT(*), SUM(is_default), COUNT(DISTINCT secret_ref) FROM providers;"
find '/Volumes/ORICO/ZoroCodingData/AppData/secrets' -type f -name '*.secret' | wc -l
```

Expected: identical ASAR hashes, `9|1|9`, and 9 encrypted secret files.

- [ ] **Step 6: Perform live UI acceptance**

Launch `/Volumes/ORICO/ZoroCoding.app` and verify:

1. First frame and title-bar content area are black.
2. Main page, settings, model dialog, progress panel, and scrollbars contain only app-controlled black and green.
3. KIMI K3 is still marked default and all 9 providers are listed.
4. A disposable project task shows a visible progress bar and countdown.
5. AI text, terminal output, parsed diff, success, warning, and error states are black-green and readable.
6. Hover and selection invert to green background with black text.
7. Disabled controls use dashed green borders without fading.
8. Developer Console reports 0 errors and 0 issues.

- [ ] **Step 7: Publish the local handoff artifacts**

Update `/Users/vion/Documents/Codex/2026-07-28/1-codex-2-zorocoding-3-3/outputs/ZoroCoding-安装与验收说明.md` with:

- installed path;
- data and project paths;
- app version and architecture;
- DMG SHA-256;
- automated test totals;
- black-green acceptance results;
- note that the build is ad-hoc signed and not notarized;
- note that providers remain encrypted on ORICO and KIMI K3 remains default.

- [ ] **Step 8: Final verification checkpoint**

Run:

```bash
git status --short
git log -5 --oneline
```

Expected: no uncommitted source changes, generated release artifacts present, ORICO installation verified, and all required outputs available.
