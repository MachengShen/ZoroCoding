import { FolderOpen, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type { ProjectSummary } from "../../shared/domain";
import type {
  CreateTaskRequest,
  ProviderSummary,
  ResolvedRouteView,
  RoutingConfigView,
} from "../../shared/ipc";
import {
  classifyTask,
  type ModelSelection,
  type TaskIntent,
} from "../../shared/taskRouting";
import { CustomSelect } from "./CustomSelect";

const INTENT_LABELS: Record<TaskIntent, string> = {
  simple_qa: "简单问答",
  simple_text: "文字处理",
  simple_code: "代码解释",
  complex_code: "复杂代码",
  media_script: "绘图 / 视频脚本",
};

function executionModeCopy(mode: "read_only" | "agentic"): string {
  return mode === "read_only" ? "只读问答" : "完整执行";
}

function missingRoleCopy(
  config: RoutingConfigView,
  lane: "light" | "premium",
): string | null {
  if (lane === "light" && config.lightProviderId === null) {
    return "轻量模型未配置";
  }
  if (lane === "premium" && config.premiumProviderId === null) {
    return "高级模型未配置";
  }
  return null;
}

interface NewTaskDialogProps {
  projects: ProjectSummary[];
  providers: ProviderSummary[];
  initialPrompt?: string;
  requireExplicitProjectSelection?: boolean;
  onAuthorizeProject(): Promise<ProjectSummary | null>;
  onSubmit(input: CreateTaskRequest): Promise<void>;
  onClose(): void;
  onOpenSettings(): void;
}

export function NewTaskDialog({
  projects,
  providers,
  initialPrompt = "",
  requireExplicitProjectSelection = false,
  onAuthorizeProject,
  onSubmit,
  onClose,
  onOpenSettings,
}: NewTaskDialogProps) {
  const [projectId, setProjectId] = useState(
    requireExplicitProjectSelection ? "" : (projects[0]?.id ?? ""),
  );
  const [manualProviderId, setManualProviderId] = useState(
    providers.find((provider) => provider.isDefault)?.id ??
      providers[0]?.id ??
      "",
  );
  const [selectionMode, setSelectionMode] = useState<"auto" | "manual">(
    "auto",
  );
  const [prompt, setPrompt] = useState(initialPrompt);
  const [routingConfig, setRoutingConfig] = useState<RoutingConfigView | null>(
    null,
  );
  const [routingLoading, setRoutingLoading] = useState(true);
  const [preview, setPreview] = useState<ResolvedRouteView | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const previewRequest = useRef(0);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects],
  );
  const selection = useMemo<ModelSelection>(
    () =>
      selectionMode === "auto"
        ? { mode: "auto" }
        : { mode: "manual", providerId: manualProviderId },
    [manualProviderId, selectionMode],
  );
  const decision = useMemo(
    () => (prompt.trim() ? classifyTask(prompt) : null),
    [prompt],
  );
  const missingRole =
    selection.mode === "auto" && decision !== null && routingConfig !== null
      ? missingRoleCopy(routingConfig, decision.lane)
      : null;

  useEffect(() => {
    let disposed = false;
    void window.zoro.routing
      .get()
      .then((config) => {
        if (!disposed) {
          setRoutingConfig(config);
        }
      })
      .catch(() => {
        if (!disposed) {
          setPreviewError("无法读取自动模型路由设置。");
        }
      })
      .finally(() => {
        if (!disposed) {
          setRoutingLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const promptValue = prompt.trim();
    const requestId = ++previewRequest.current;
    let disposed = false;
    setPreview(null);
    setPreviewError(null);
    setPreviewing(false);

    if (
      promptValue.length === 0 ||
      (selection.mode === "manual" && selection.providerId.length === 0) ||
      (selection.mode === "auto" && (routingLoading || missingRole !== null))
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      setPreviewing(true);
      void window.zoro.routing
        .preview({ prompt: promptValue, selection })
        .then((result) => {
          if (!disposed && previewRequest.current === requestId) {
            setPreview(result);
          }
        })
        .catch(() => {
          if (!disposed && previewRequest.current === requestId) {
            setPreviewError("无法预览模型路由，请检查设置后重试。");
          }
        })
        .finally(() => {
          if (!disposed && previewRequest.current === requestId) {
            setPreviewing(false);
          }
        });
    }, 180);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [missingRole, prompt, routingLoading, selection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const authorize = async () => {
    const project = await onAuthorizeProject();
    if (project !== null) {
      setProjectId(project.id);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !projectId ||
      !prompt.trim() ||
      previewError !== null ||
      missingRole !== null ||
      routingLoading ||
      (selection.mode === "manual" && !selection.providerId)
    ) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        projectId,
        prompt: prompt.trim(),
        selection,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !submitting &&
    !routingLoading &&
    projectId.length > 0 &&
    prompt.trim().length > 0 &&
    previewError === null &&
    missingRole === null &&
    (selection.mode === "auto" || selection.providerId.length > 0);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal new-task-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-task-title"
      >
        <header className="modal-header">
          <div>
            <h2 id="new-task-title">发起新任务</h2>
            <p>选择项目后，自动路由会按任务内容匹配模型和安全执行方式。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <form autoComplete="off" onSubmit={submit}>
          <div className="field">
            <span className="field-label">本地项目</span>
            <button
              className="project-picker"
              type="button"
              aria-label="选择项目"
              onClick={authorize}
            >
              <FolderOpen aria-hidden="true" />
              <span>
                {selectedProject?.name ?? "选择项目"}
                <small>
                  {selectedProject?.canonicalPath ??
                    "通过 macOS 文件夹选择器授权"}
                </small>
              </span>
            </button>
          </div>

          <fieldset className="field routing-selection">
            <legend className="field-label">模型选择</legend>
            <label>
              <input
                type="radio"
                name="model-selection"
                checked={selectionMode === "auto"}
                onChange={() => setSelectionMode("auto")}
              />
              自动选择（推荐）
            </label>
            <label>
              <input
                type="radio"
                name="model-selection"
                checked={selectionMode === "manual"}
                onChange={() => setSelectionMode("manual")}
              />
              手动选择
            </label>
            {selectionMode === "manual" ? (
              <div className="field routing-manual-provider">
                <span className="field-label">手动模型</span>
                <CustomSelect
                  label="手动模型"
                  value={manualProviderId}
                  placeholder="请选择模型"
                  options={providers.map((provider) => ({
                    value: provider.id,
                    label: `${provider.name} · ${provider.modelId}`,
                  }))}
                  onChange={setManualProviderId}
                />
              </div>
            ) : (
              <small>自动路由只决定模型；执行权限仍由任务分类结果决定。</small>
            )}
          </fieldset>

          <label className="field">
            <span className="field-label">任务要求</span>
            <textarea
              autoFocus
              autoComplete="off"
              rows={7}
              value={prompt}
              placeholder="例如：修复登录状态恢复，并运行相关测试"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          {decision !== null ? (
            <section className="route-preview" aria-live="polite">
              <span>已识别：{INTENT_LABELS[decision.intent]}</span>
              <span>
                执行方式：
                <strong>{executionModeCopy(decision.executionMode)}</strong>
              </span>
              {preview !== null ? (
                <span>
                  实际模型：
                  <strong>
                    {preview.provider.name} · {preview.provider.modelId}
                  </strong>
                </span>
              ) : previewing ? (
                <span>正在预览模型…</span>
              ) : null}
            </section>
          ) : null}

          {missingRole !== null ? (
            <div className="inline-notice route-missing-role" role="status">
              <span>{missingRole}</span>
              <button type="button" onClick={onOpenSettings}>
                前往设置
              </button>
            </div>
          ) : null}

          {previewError !== null ? (
            <p className="inline-notice route-preview-error" role="alert">
              {previewError}
            </p>
          ) : null}

          {providers.length === 0 ? (
            <p className="inline-notice">
              请先在“设置与模型”中添加 KIMI 或其他模型 API。
            </p>
          ) : null}

          <footer className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              取消
            </button>
            <button className="primary-button" type="submit" disabled={!canSubmit}>
              {submitting ? "正在创建…" : "开始任务"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
