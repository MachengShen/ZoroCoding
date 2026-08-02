import {
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, type FormEvent } from "react";

import type { QuickChatMessage } from "../../shared/domain";
import {
  classifyTask,
  type ModelSelection,
  type RouteReasonCode,
  type TaskIntent,
} from "../../shared/taskRouting";
import type { ZoroStore } from "../state/useZoroStore";
import { CustomSelect } from "./CustomSelect";

const INTENT_LABELS: Record<TaskIntent, string> = {
  simple_qa: "简单问答",
  simple_text: "文字处理",
  simple_code: "代码解释",
  complex_code: "复杂代码",
  media_script: "绘图 / 视频脚本",
};

const REASON_LABELS: Record<RouteReasonCode, string> = {
  "simple-question": "简单问题",
  "text-transform": "文字处理",
  "code-explanation": "代码解释",
  "project-change": "需要修改或验证项目",
  "multi-step-code": "多步骤代码任务",
  "media-generation": "绘图或视频生成",
  "ambiguous-premium-default": "需求不明确，使用高级模型",
};

function missingRole(
  store: ZoroStore,
  selection: ModelSelection,
  lane: "light" | "premium",
): string | null {
  if (selection.mode !== "auto" || store.routingConfig === null) {
    return null;
  }
  if (lane === "light" && store.routingConfig.lightProviderId === null) {
    return "轻量模型未配置";
  }
  if (
    lane === "premium" &&
    store.routingConfig.premiumProviderId === null
  ) {
    return "高级模型未配置";
  }
  return null;
}

function Message({
  message,
  streamedText,
  selection,
  sending,
  onRetry,
  onChangeModel,
}: {
  message: QuickChatMessage;
  streamedText: string;
  selection: ModelSelection;
  sending: boolean;
  onRetry(messageId: string): void;
  onChangeModel(): void;
}) {
  if (message.role === "user") {
    return (
      <article className="quick-chat-message quick-chat-user-message">
        <span>你</span>
        <p>{message.content}</p>
      </article>
    );
  }

  const content =
    message.status === "streaming"
      ? `${message.content}${streamedText}`
      : message.content;

  return (
    <article className="quick-chat-message quick-chat-assistant-message">
      <header>
        <strong>ZoroCoding</strong>
        {message.providerSnapshot !== null ? (
          <small>
            {`实际模型：${message.providerSnapshot.name} · ${message.providerSnapshot.modelId}`}
          </small>
        ) : null}
      </header>
      {content ? <p>{content}</p> : <p aria-label="正在回答">正在回答…</p>}
      {message.status === "failed" || message.status === "canceled" ? (
        <div className="quick-chat-failure">
          <p role="alert">
            {message.errorMessage ??
              (message.status === "canceled"
                ? "回答已取消。"
                : "模型请求失败。")}
          </p>
          <div>
            <button
              className="secondary-button"
              type="button"
              disabled={sending}
              onClick={() => onRetry(message.id)}
            >
              重试这条回复
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={onChangeModel}
            >
              更换模型
            </button>
          </div>
          <small>
            重试会继续使用
            {selection.mode === "auto" ? "自动路由" : "当前手动模型"}。
          </small>
        </div>
      ) : null}
    </article>
  );
}

export function QuickChatView({ store }: { store: ZoroStore }) {
  const decision = useMemo(
    () =>
      store.quickChatPrompt.trim().length > 0
        ? classifyTask(store.quickChatPrompt)
        : null,
    [store.quickChatPrompt],
  );
  const roleMissing =
    decision === null
      ? null
      : missingRole(store, store.quickChatSelection, decision.lane);
  const defaultManualProvider =
    store.providers.find((provider) => provider.isDefault) ??
    store.providers[0];
  const manualProviderId =
    store.quickChatSelection.mode === "manual"
      ? store.quickChatSelection.providerId
      : (defaultManualProvider?.id ?? "");
  const activeSession = store.quickChatSessions.find(
    (session) => session.id === store.activeQuickChatSessionId,
  );

  useEffect(() => {
    if (
      decision === null ||
      roleMissing !== null ||
      store.routingConfig === null ||
      (store.quickChatSelection.mode === "manual" &&
        store.quickChatSelection.providerId.length === 0)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void store.previewQuickChatRoute(
        store.quickChatPrompt,
        store.quickChatSelection,
      );
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    decision,
    roleMissing,
    store.previewQuickChatRoute,
    store.quickChatPrompt,
    store.quickChatSelection,
    store.routingConfig,
  ]);

  const changeToManual = () => {
    if (manualProviderId.length > 0) {
      store.setQuickChatSelection({
        mode: "manual",
        providerId: manualProviderId,
      });
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (
      !store.storageReady ||
      store.quickChatSending ||
      store.quickChatPrompt.trim().length === 0 ||
      store.activeQuickChatSessionId === null ||
      store.routingConfig === null ||
      roleMissing !== null ||
      store.quickChatPreviewError !== null ||
      (store.quickChatSelection.mode === "manual" &&
        store.quickChatSelection.providerId.length === 0)
    ) {
      return;
    }
    void store.sendQuickChat();
  };

  const renameSession = () => {
    if (activeSession === undefined) {
      return;
    }
    const title = window.prompt("输入新的对话名称", activeSession.title);
    if (title !== null && title.trim().length > 0) {
      void store.renameQuickChatSession(activeSession.id, title);
    }
  };

  const deleteSession = () => {
    if (
      activeSession !== undefined &&
      window.confirm(`删除对话“${activeSession.title}”？`)
    ) {
      void store.deleteQuickChatSession(activeSession.id);
    }
  };

  return (
    <section
      className="quick-chat-view"
      aria-labelledby="quick-chat-title"
    >
      <header className="quick-chat-header">
        <div>
          <span className="task-context">无项目对话</span>
          <h1 id="quick-chat-title">快速问答</h1>
          <p>只与模型对话，不连接项目或本地工具。</p>
        </div>
        <div className="quick-chat-session-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={!store.storageReady}
            onClick={() => void store.createQuickChatSession()}
          >
            <Plus aria-hidden="true" />
            新对话
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="重命名当前对话"
            disabled={activeSession === undefined || !store.storageReady}
            onClick={renameSession}
          >
            <Pencil aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="删除当前对话"
            disabled={activeSession === undefined || !store.storageReady}
            onClick={deleteSession}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="quick-chat-feed" aria-live="polite">
        {store.quickChatMessages.length === 0 ? (
          <div className="quick-chat-empty">
            <MessageCircle aria-hidden="true" />
            <strong>直接问任何问题</strong>
            <p>简单问答会优先使用免费模型，复杂内容会自动使用 KIMI K3。</p>
          </div>
        ) : (
          store.quickChatMessages.map((message) => (
            <Message
              key={message.id}
              message={message}
              streamedText={
                store.quickChatStreamingText[message.id] ?? ""
              }
              selection={store.quickChatSelection}
              sending={store.quickChatSending}
              onRetry={(messageId) =>
                void store.retryQuickChat(messageId)
              }
              onChangeModel={changeToManual}
            />
          ))
        )}
      </div>

      <form
        className="quick-chat-composer"
        autoComplete="off"
        onSubmit={submit}
      >
        <fieldset className="quick-chat-model-selection">
          <legend>模型选择</legend>
          <label>
            <input
              type="radio"
              name="quick-chat-model-selection"
              checked={store.quickChatSelection.mode === "auto"}
              onChange={() =>
                store.setQuickChatSelection({ mode: "auto" })
              }
            />
            自动选择（推荐）
          </label>
          <label>
            <input
              type="radio"
              name="quick-chat-model-selection"
              checked={store.quickChatSelection.mode === "manual"}
              onChange={changeToManual}
            />
            手动选择
          </label>
          {store.quickChatSelection.mode === "manual" ? (
            <div className="quick-chat-manual-provider">
              <span>手动模型</span>
              <CustomSelect
                label="手动模型"
                value={store.quickChatSelection.providerId}
                placeholder="请选择模型"
                options={store.providers.map((provider) => ({
                  value: provider.id,
                  label: `${provider.name} · ${provider.modelId}`,
                }))}
                onChange={(providerId) =>
                  store.setQuickChatSelection({
                    mode: "manual",
                    providerId,
                  })
                }
              />
            </div>
          ) : null}
        </fieldset>

        {decision !== null ? (
          <section className="quick-chat-route-preview">
            <span>
              路由：
              <strong>
                {decision.lane === "light" ? "轻量模型" : "高级模型"}
              </strong>
            </span>
            <span>
              原因：
              <strong>{REASON_LABELS[decision.reasonCode]}</strong>
            </span>
            <span>类型：{INTENT_LABELS[decision.intent]}</span>
            {store.quickChatRoutePreview !== null ? (
              <span>
                实际模型：
                <strong>
                  {store.quickChatRoutePreview.provider.name} ·{" "}
                  {store.quickChatRoutePreview.provider.modelId}
                </strong>
              </span>
            ) : store.quickChatPreviewing ? (
              <span>正在预览模型…</span>
            ) : null}
          </section>
        ) : null}

        {decision?.intent === "media_script" ? (
          <div className="inline-notice quick-chat-media-notice">
            <span>此处只能生成方案或代码，不能直接创建本地文件。</span>
            <button
              type="button"
              onClick={() =>
                store.convertQuickChatToProject(store.quickChatPrompt)
              }
            >
              转为项目任务
            </button>
          </div>
        ) : null}

        {roleMissing !== null ? (
          <div className="inline-notice" role="status">
            <span>{roleMissing}</span>
            <button type="button" onClick={() => store.setView("settings")}>
              前往设置
            </button>
          </div>
        ) : null}

        {store.quickChatPreviewError !== null ? (
          <p className="inline-notice" role="alert">
            {store.quickChatPreviewError}
          </p>
        ) : null}

        <div className="quick-chat-input-row">
          <textarea
            aria-label="快速问答内容"
            autoComplete="off"
            rows={3}
            value={store.quickChatPrompt}
            disabled={!store.storageReady}
            placeholder="输入问题、解释、翻译或代码需求"
            onChange={(event) =>
              store.setQuickChatPrompt(event.target.value)
            }
          />
          {store.quickChatSending ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void store.cancelQuickChat()}
            >
              <Square aria-hidden="true" />
              取消回答
            </button>
          ) : (
            <button
              className="primary-button"
              type="submit"
              disabled={
                !store.storageReady ||
                store.quickChatPrompt.trim().length === 0 ||
                store.activeQuickChatSessionId === null ||
                store.routingConfig === null ||
                roleMissing !== null ||
                store.quickChatPreviewError !== null ||
                (store.quickChatSelection.mode === "manual" &&
                  store.quickChatSelection.providerId.length === 0)
              }
            >
              <Send aria-hidden="true" />
              发送
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
