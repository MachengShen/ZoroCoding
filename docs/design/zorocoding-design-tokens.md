# ZoroCoding Visual Specification

## Locked concept sources

- Primary workbench: `docs/design/zorocoding-workbench-concept.png`
- Provider settings: `docs/design/zorocoding-provider-settings-concept.png`
- Native concept size: 1536 × 1024

These concepts refine the approved three-column Codex Workbench wireframe. The generated images are visual references only; every application label, control, icon, code line, terminal line, progress value, and form field remains code-native.

## Visual point of view

ZoroCoding is a focused macOS engineering tool: dark task history on the left, a true-white execution canvas in the center, and a quiet progress command rail on the right. Fluorescent lime marks the next useful action and current execution state. The interface has no marketing layer, decorative illustration, gradient, glow, glass effect, or dashboard-card wall.

## Layout

### Desktop reference: 1536 × 1024

- macOS title bar: 42 px high, true white, 1 px bottom border.
- left task rail: 318 px in the concept; implementation range 280–318 px.
- center workbench: flexible, minimum 640 px.
- right progress rail: 370–410 px including the narrow collapse divider.
- provider settings sheet: 410 px, anchored to the right edge.
- application body fills the remaining viewport height without page scrolling.
- task timeline and settings content own their internal scroll areas.

### Compact widths

- Below 1180 px: left rail contracts to 248 px; right rail becomes a drawer.
- Below 900 px: left rail contracts to a 72 px icon rail; task titles move to a popover.
- The new-task action, current task, model selector, task progress entry, pause/resume, and approval state remain reachable at every supported width.

## Color lock

| Token | Value | Role |
|---|---:|---|
| `--color-sidebar` | `#1f211e` | dark left rail |
| `--color-sidebar-elevated` | `#30332e` | selected task row |
| `--color-canvas` | `#ffffff` | true-white center surface |
| `--color-progress` | `#fafbf8` | pale neutral progress/settings rail |
| `--color-accent` | `#c9ff62` | primary action and active progress |
| `--color-accent-strong` | `#79b91b` | semantic completed state |
| `--color-ink` | `#20221f` | main text |
| `--color-muted` | `#74786f` | secondary text |
| `--color-subtle` | `#9ba097` | tertiary labels |
| `--color-border` | `#dde0d8` | dividers and control borders |
| `--color-soft` | `#f3f5f0` | message and hover backgrounds |
| `--color-danger` | `#d74d47` | destructive action |
| `--color-warning` | `#d58c2a` | waiting and recoverable warning |
| `--color-info` | `#4f8fd8` | neutral informational state |
| `--color-terminal` | `#202420` | terminal surface |

No gradient is allowed. Center backgrounds remain true white. Lime is not replaced with teal, blue, or muted olive.

## Typography

- family: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "PingFang SC", sans-serif`
- code: `"SFMono-Regular", "SF Mono", Menlo, Consolas, monospace`
- task/page title: 24 px / 1.25 / 680
- section title: 18 px / 1.35 / 650
- large countdown: 56 px / 1 / 580 / `-0.045em`
- body: 14 px / 1.55 / 400
- primary controls: 14 px / 1 / 620
- task rows: 14 px / 1.35 / 560
- utility controls: 12 px / 1.2 / 540
- captions and timestamps: 11 px / 1.35 / 450
- terminal and code: 12 px / 1.55 / 450

Buttons, inputs, sidebar rows, model controls, progress rows, terminal chrome, and settings actions must set their font size and weight explicitly.

## Spacing, geometry, and elevation

- spacing scale: 4, 8, 12, 16, 20, 24, 32, 40 px.
- control height: 36 px compact; 44 px primary.
- field height: 44 px.
- row height: 56–72 px depending on metadata.
- radii: 6 px compact, 8 px controls, 12 px messages/panels.
- borders: 1 px solid `--color-border`.
- focus ring: 2 px `#92c83f`, 2 px offset.
- shadows: only composer and modal/sheet elevation; use `0 12px 32px rgba(24, 28, 22, 0.10)`.
- motion: 140 ms for hover/selection, 220 ms for drawers, disabled under `prefers-reduced-motion`.

## Container model

- Sidebar, workbench, and progress rail are full-height bands separated by borders.
- Task history, execution activity, provider rows, and progress steps are open lists, not cards.
- File diffs and terminal output use a single necessary bordered frame.
- Message bubbles are used only for user messages.
- Provider editing uses a right-side sheet.
- Approval uses one centered modal because it blocks execution.

Nested cards, bento grids, floating dashboard tiles, fake charts, and decorative statistics are prohibited.

## Brand mark

- Code-native lime square, 36 × 36 px on desktop.
- 8 px radius.
- black `Z`, 22 px, 800 weight, optically centered.
- No generated raster logo is used in the product.

## Icon inventory

Use Lucide outline icons only, normally 18–20 px with 1.6 px stroke:

- `PlusCircle`: new task.
- `Folder`, `FolderOpen`: project.
- `ChevronRight`, `ChevronDown`: disclosure and rows.
- `CheckCircle2`: completed task/step.
- `Circle`, `LoaderCircle`: pending/running.
- `PauseCircle`, `PlayCircle`, `Square`: task controls.
- `BookOpen`, `Code2`, `PencilLine`, `Globe2`, `FileText`: execution activities.
- `Paperclip`, `Send`: composer.
- `Settings`, `SlidersHorizontal`: settings.
- `TerminalSquare`: terminal.
- `PlugZap`: provider connection test.
- `Star`, `Trash2`, `Eye`, `EyeOff`, `X`: provider and sheet actions.
- `PanelLeftClose`, `PanelRightClose`: rail collapse controls.
- `AlertTriangle`: approval and recoverable errors.

Filled icons are not mixed into the outline family. Semantic state circles may use solid lime fills.

## Primary screen visible-copy lock

Allowed primary-screen strings:

- `ZoroCoding`
- `发起新任务`
- `当前项目`
- `zoro-web-platform`
- `今天`
- `昨天`
- `优化模型配置页面`
- `执行中 · 64%`
- `修复用户登录状态问题`
- `已完成 · 18:42`
- `重构 API 请求层`
- `已暂停 · 10:05`
- `设置与模型`
- `zoro-web-platform · main`
- `KIMI K3`
- `暂停`
- `你`
- `请优化模型配置页面，支持新增、编辑、删除模型 API 配置，并验证连接可用性。`
- `好的，我将优化模型配置页面，支持增删改查并验证连接。以下是执行计划和进度。`
- `读取项目上下文`
- `创建模型适配器`
- `更新设置页面`
- `验证连接功能`
- `src/providers/model-provider.ts`
- `继续输入要求，或拖入文件…`
- `发送`
- `任务进度`
- `执行中`
- `06:42`
- `预计剩余`
- `64%`
- `已用 11:18`
- `读取项目与分析需求`
- `实现模型配置增删改`
- `验证连接可用性`
- `运行测试与收尾`
- `终端输出`
- `12 tests passed`

No eyebrow, badge, metric chip, product claim, helper subtitle, or unrelated navigation is added above the fold.

## Settings visible-copy lock

- `模型与 API 管理`
- `管理内置模型与自定义 API 提供商，配置后可在任务中选择使用。`
- `添加模型 API`
- `名称`
- `类型`
- `Base URL`
- `状态`
- `默认`
- `操作`
- `KIMI K3`
- `官方 Moonshot API · 默认模型`
- `团队模型`
- `OpenAI 兼容 · api.example.com`
- `已连接`
- `测试`
- `编辑`
- `设为默认`
- `删除`
- `添加模型 API`
- `API Key`
- `模型 ID`
- `上下文长度`
- `可选请求头`
- `连接测试`
- `连接成功`
- `API 响应正常，可正常使用。`
- `测试连接`
- `取消`
- `保存`

The generated example `gpt-4o` is not a product default. User-entered model IDs are displayed verbatim.

## Component families

- `Button`: primary lime, neutral outline, quiet icon, danger text.
- `TaskRow`: selected, running, completed, paused.
- `ActivityRow`: completed, running, pending, failed, expandable.
- `ProgressStep`: completed, running, pending, failed, skipped.
- `StatusText`: icon + text; never color-only.
- `ToolbarControl`: model select, pause/resume, rail collapse.
- `Composer`: attachment, multiline prompt, send.
- `ProviderRow`: built-in/custom, connected/error/testing, default/non-default.
- `Field`: text, URL, secret, number, key/value header row.
- `Sheet`: add/edit provider.
- `Modal`: approval, destructive confirmation.
- `InlineError`: auth, missing model, rate limit, network, server.

## Core state references

- Primary concept: running task at 64%, two completed steps, one current step, one pending step.
- Settings concept: one built-in KIMI provider, one connected custom provider, add-provider sheet open, connection success.
- Required implementation-only states in the same system: empty first run, planning, awaiting approval, paused, interrupted recovery, failed, completed, provider connection error, delete confirmation.

## Media and asset treatment

There is no hero image, illustration, avatar photo, texture, or raster brand asset. The only raster files are design-reference screenshots. Product UI is implemented entirely with semantic React, CSS, and SVG icon components.
