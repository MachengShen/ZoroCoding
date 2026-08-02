import {
  Eye,
  EyeOff,
  Plus,
  PlugZap,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type {
  ModelOption,
  ProviderTemplate,
} from "../../shared/domain";
import type {
  ProviderInput,
  ProviderSummary,
  ProviderTestInput,
} from "../../shared/ipc";
import { CustomSelect } from "./CustomSelect";

interface HeaderRow {
  id: number;
  name: string;
  value: string;
}

interface ProviderDialogProps {
  provider?: ProviderSummary;
  template?: ProviderTemplate;
  mutationsDisabled?: boolean;
  onSaved(provider: ProviderSummary): void;
  onClose(): void;
}

const FORBIDDEN_HEADERS = new Set(["authorization", "cookie", "host"]);

interface DiscoveryIdentity {
  baseUrl: string;
  apiKey: string;
  headers: ReadonlyArray<readonly [string, string]>;
}

function createDiscoveryIdentity(
  baseUrl: string,
  apiKey: string,
  headers: Record<string, string>,
): DiscoveryIdentity {
  return {
    baseUrl: baseUrl.trim().replace(/\/+$/, ""),
    apiKey,
    headers: Object.entries(headers)
      .map(
        ([name, value]) =>
          [name.trim().toLowerCase(), value.trim()] as const,
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  };
}

function sameDiscoveryIdentity(
  left: DiscoveryIdentity,
  right: DiscoveryIdentity,
): boolean {
  return (
    left.baseUrl === right.baseUrl &&
    left.apiKey === right.apiKey &&
    left.headers.length === right.headers.length &&
    left.headers.every(
      ([name, value], index) =>
        name === right.headers[index]?.[0] &&
        value === right.headers[index]?.[1],
    )
  );
}

function validateUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Base URL 必须是有效网址。";
  }
  const local =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    return "远程 API 必须使用 HTTPS；仅 localhost 可使用 HTTP。";
  }
  return null;
}

function errorCopy(caught: unknown): string {
  const message =
    caught instanceof Error ? caught.message : "模型连接失败，请稍后重试。";
  const lower = message.toLowerCase();
  if (lower.includes("鉴权") || lower.includes("auth")) {
    return "鉴权失败，请检查 API Key。";
  }
  if (lower.includes("未找到") || lower.includes("not found")) {
    return "未找到模型，请检查 Base URL 和模型 ID。";
  }
  if (lower.includes("频繁") || lower.includes("rate")) {
    return "请求过于频繁，请稍后重试。";
  }
  if (lower.includes("网络") || lower.includes("connect")) {
    return "网络连接失败，请检查 API 地址和网络。";
  }
  return "模型连接失败，请检查配置后重试。";
}

export function ProviderDialog({
  provider,
  template,
  mutationsDisabled = false,
  onSaved,
  onClose,
}: ProviderDialogProps) {
  const editing = provider !== undefined;
  const requiresDiscovery = !editing && template?.requiresDiscovery === true;
  const [name, setName] = useState(provider?.name ?? template?.name ?? "");
  const [kind, setKind] = useState<ProviderInput["kind"]>(
    provider?.kind ?? template?.kind ?? "openai-compatible",
  );
  const [baseUrl, setBaseUrl] = useState(
    provider?.baseUrl ?? template?.baseUrl ?? "https://api.example.com/v1",
  );
  const [modelId, setModelId] = useState(
    provider?.modelId ?? template?.suggestedModelId ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  const [contextLength, setContextLength] = useState(
    String(provider?.contextLength ?? template?.contextLength ?? 128_000),
  );
  const [isDefault, setIsDefault] = useState(provider?.isDefault ?? false);
  const [headers, setHeaders] = useState<HeaderRow[]>(
    Object.entries(provider?.headers ?? {}).map(([headerName, value], index) => ({
      id: index + 1,
      name: headerName,
      value,
    })),
  );
  const [nextHeaderId, setNextHeaderId] = useState(headers.length + 1);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [discoveryReady, setDiscoveryReady] = useState(!requiresDiscovery);
  const [connectionState, setConnectionState] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [connectionDetail, setConnectionDetail] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const latestDiscoveryToken = useRef(0);
  const mounted = useRef(false);

  const headerRecord = useMemo(
    () =>
      Object.fromEntries(
        headers
          .filter((header) => header.name.trim())
          .map((header) => [header.name.trim(), header.value]),
      ),
    [headers],
  );
  const currentDiscoveryIdentity = useMemo(
    () => createDiscoveryIdentity(baseUrl, apiKey, headerRecord),
    [apiKey, baseUrl, headerRecord],
  );
  const currentDiscoveryIdentityRef = useRef(currentDiscoveryIdentity);
  currentDiscoveryIdentityRef.current = currentDiscoveryIdentity;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      latestDiscoveryToken.current += 1;
      currentDiscoveryIdentityRef.current = {
        baseUrl: "",
        apiKey: "",
        headers: [],
      };
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const validate = (requiresKey: boolean): string[] => {
    const nextErrors: string[] = [];
    if (name.trim().length < 1 || name.trim().length > 60) {
      nextErrors.push("名称需为 1–60 个字符。");
    }
    const urlError = validateUrl(baseUrl.trim());
    if (urlError !== null) {
      nextErrors.push(urlError);
    }
    if (modelId.trim().length < 1 || modelId.trim().length > 120) {
      nextErrors.push("模型 ID 需为 1–120 个字符。");
    }
    const parsedContext = Number(contextLength);
    if (
      !Number.isInteger(parsedContext) ||
      parsedContext < 1_024 ||
      parsedContext > 2_000_000
    ) {
      nextErrors.push("上下文长度需为 1,024–2,000,000 的整数。");
    }
    if (requiresKey && apiKey.length === 0) {
      nextErrors.push("API Key 不能为空。");
    }
    for (const header of headers) {
      if (FORBIDDEN_HEADERS.has(header.name.trim().toLowerCase())) {
        nextErrors.push(`不能自定义 ${header.name.trim()} 请求头。`);
      }
      if (header.name.trim() && !header.value.trim()) {
        nextErrors.push(`请求头 ${header.name.trim()} 缺少值。`);
      }
    }
    setErrors(nextErrors);
    return nextErrors;
  };

  const input = (): ProviderInput => ({
    name: name.trim(),
    kind,
    baseUrl: baseUrl.trim().replace(/\/+$/, ""),
    modelId: modelId.trim(),
    contextLength: Number(contextLength),
    headers: headerRecord,
    apiKey: apiKey || undefined,
    isDefault,
    billingNote: provider?.billingNote ?? template?.billingNote,
    dashboardUrl: provider?.dashboardUrl ?? template?.dashboardUrl,
  });

  const invalidateDiscovery = () => {
    latestDiscoveryToken.current += 1;
    setDiscovering(false);
    setModelOptions([]);
    if (requiresDiscovery) {
      setDiscoveryReady(false);
    }
  };

  const changeKind = (nextKind: ProviderInput["kind"]) => {
    invalidateDiscovery();
    setKind(nextKind);
    if (nextKind === "kimi" && !editing) {
      setName("KIMI K3");
      setBaseUrl("https://api.moonshot.cn/v1");
      setModelId("kimi-k3");
      setContextLength("1000000");
    }
  };

  const discoverModels = async () => {
    const nextErrors: string[] = [];
    const urlError = validateUrl(baseUrl.trim());
    if (urlError !== null) {
      nextErrors.push(urlError);
    }
    if (apiKey.trim().length === 0) {
      nextErrors.push("API Key 不能为空。");
    }
    for (const header of headers) {
      if (FORBIDDEN_HEADERS.has(header.name.trim().toLowerCase())) {
        nextErrors.push(`不能自定义 ${header.name.trim()} 请求头。`);
      }
      if (header.name.trim() && !header.value.trim()) {
        nextErrors.push(`请求头 ${header.name.trim()} 缺少值。`);
      }
    }
    setErrors(nextErrors);
    if (nextErrors.length > 0 || mutationsDisabled) {
      return;
    }
    const requestToken = latestDiscoveryToken.current + 1;
    latestDiscoveryToken.current = requestToken;
    const requestIdentity = createDiscoveryIdentity(
      baseUrl,
      apiKey,
      headerRecord,
    );
    const requestIsCurrent = () =>
      mounted.current &&
      latestDiscoveryToken.current === requestToken &&
      sameDiscoveryIdentity(
        currentDiscoveryIdentityRef.current,
        requestIdentity,
      );
    setDiscovering(true);
    setDiscoveryReady(false);
    try {
      const discovered = await window.zoro.providers.discoverModels({
        baseUrl: requestIdentity.baseUrl,
        apiKey: requestIdentity.apiKey,
        headers: headerRecord,
      });
      if (!requestIsCurrent()) {
        return;
      }
      setModelOptions(discovered);
      setModelId("");
      if (discovered.length === 0) {
        setErrors(["服务商没有返回可用模型。"]);
      }
    } catch (caught) {
      if (!requestIsCurrent()) {
        return;
      }
      setErrors([errorCopy(caught)]);
      setModelOptions([]);
    } finally {
      if (requestIsCurrent()) {
        setDiscovering(false);
      }
    }
  };

  const testConnection = async () => {
    if (mutationsDisabled) {
      return;
    }
    if (validate(true).length > 0) {
      return;
    }
    setTesting(true);
    setConnectionState("idle");
    try {
      const result = await window.zoro.providers.test({
        ...input(),
        apiKey,
      } as ProviderTestInput);
      setConnectionState("success");
      setConnectionDetail(`API 响应正常，可正常使用。${result.latencyMs} ms`);
    } catch (caught) {
      setConnectionState("error");
      setConnectionDetail(errorCopy(caught));
    } finally {
      setTesting(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (mutationsDisabled || (requiresDiscovery && !discoveryReady)) {
      return;
    }
    if (validate(!editing).length > 0) {
      return;
    }
    setSaving(true);
    try {
      const value = input();
      const saved = editing
        ? await window.zoro.providers.update(provider.id, value)
        : await window.zoro.providers.create({
            ...value,
            apiKey,
          });
      onSaved(saved);
    } catch (caught) {
      setErrors([errorCopy(caught)]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="presentation">
      <section
        className="provider-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-dialog-title"
      >
        <header className="sheet-header">
          <div>
            <h2 id="provider-dialog-title">
              {editing ? "编辑模型 API" : "添加模型 API"}
            </h2>
            <p>兼容 OpenAI Chat Completions 接口。</p>
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

        <form className="provider-form" autoComplete="off" onSubmit={save}>
          <label className="field">
            <span className="field-label">名称</span>
            <input
              autoComplete="off"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="field">
            <span className="field-label">类型</span>
            <CustomSelect
              label="类型"
              value={kind}
              options={[
                { value: "kimi", label: "KIMI / Moonshot" },
                { value: "openai-compatible", label: "OpenAI 兼容" },
              ]}
              onChange={(value) =>
                changeKind(value as ProviderInput["kind"])
              }
            />
          </div>
          <label className="field">
            <span className="field-label">Base URL</span>
            <input
              type="url"
              autoComplete="off"
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                invalidateDiscovery();
              }}
            />
          </label>
          <div className="field">
            <span className="field-label">模型 ID</span>
            {modelOptions.length > 0 ? (
              <CustomSelect
                label="模型 ID"
                value={modelId}
                placeholder="请选择已验证模型"
                options={modelOptions.map((option) => ({
                  value: option.id,
                  label: option.label,
                }))}
                onChange={(value) => {
                  setModelId(value);
                  setDiscoveryReady(value.length > 0);
                }}
              />
            ) : (
              <input
                aria-label="模型 ID"
                autoComplete="off"
                value={modelId}
                maxLength={120}
                onChange={(event) => {
                  setModelId(event.target.value);
                  invalidateDiscovery();
                }}
              />
            )}
          </div>
          <label className="field">
            <span className="field-label">
              API Key {editing ? "（留空则不修改）" : ""}
            </span>
            <span className="secret-field">
              <input
                aria-label="API Key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                autoComplete="new-password"
                onChange={(event) => {
                  setApiKey(event.target.value);
                  invalidateDiscovery();
                }}
              />
              <button
                className="icon-button"
                type="button"
                aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                onClick={() => setShowKey((current) => !current)}
              >
                {showKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </span>
          </label>
          <label className="field">
            <span className="field-label">上下文长度</span>
            <input
              type="number"
              autoComplete="off"
              min={1_024}
              max={2_000_000}
              value={contextLength}
              onChange={(event) => setContextLength(event.target.value)}
            />
          </label>

          <fieldset className="headers-fieldset">
            <legend>可选请求头</legend>
            {headers.map((header, index) => (
              <div className="header-row" key={header.id}>
                <input
                  aria-label={`请求头名称 ${index + 1}`}
                  autoComplete="off"
                  placeholder="X-Team"
                  value={header.name}
                  onChange={(event) => {
                    invalidateDiscovery();
                    setHeaders((current) =>
                      current.map((item) =>
                        item.id === header.id
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    );
                  }}
                />
                <input
                  aria-label={`请求头值 ${index + 1}`}
                  autoComplete="off"
                  placeholder="value"
                  value={header.value}
                  onChange={(event) => {
                    invalidateDiscovery();
                    setHeaders((current) =>
                      current.map((item) =>
                        item.id === header.id
                          ? { ...item, value: event.target.value }
                          : item,
                      ),
                    );
                  }}
                />
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`删除请求头 ${index + 1}`}
                  onClick={() => {
                    invalidateDiscovery();
                    setHeaders((current) =>
                      current.filter((item) => item.id !== header.id),
                    );
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              className="quiet-button"
              type="button"
              onClick={() => {
                invalidateDiscovery();
                setHeaders((current) => [
                  ...current,
                  { id: nextHeaderId, name: "", value: "" },
                ]);
                setNextHeaderId((current) => current + 1);
              }}
            >
              <Plus aria-hidden="true" />
              添加请求头
            </button>
          </fieldset>

          <label className="default-checkbox">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
            />
            保存后设为默认模型
          </label>

          {errors.length > 0 ? (
            <div className="form-error" role="alert">
              {errors.map((error) => (
                <span key={error}>{error}</span>
              ))}
            </div>
          ) : null}

          {connectionState !== "idle" ? (
            <div
              className={`connection-result ${connectionState}`}
              role="status"
            >
              <strong>
                {connectionState === "success" ? "连接成功" : "连接失败"}
              </strong>
              <span>{connectionDetail}</span>
            </div>
          ) : null}

          <footer className="sheet-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={testing || discovering || mutationsDisabled}
              onClick={() => void discoverModels()}
            >
              <RefreshCw
                className={discovering ? "spin" : undefined}
                aria-hidden="true"
              />
              {discovering ? "获取中…" : "获取可用模型"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={testing || discovering || mutationsDisabled}
              onClick={testConnection}
            >
              <PlugZap aria-hidden="true" />
              {testing ? "测试中…" : "测试连接"}
            </button>
            <span />
            <button className="secondary-button" type="button" onClick={onClose}>
              取消
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={
                testing ||
                discovering ||
                saving ||
                mutationsDisabled ||
                (!editing && apiKey.length === 0) ||
                name.trim().length === 0 ||
                modelId.trim().length === 0 ||
                (requiresDiscovery && !discoveryReady)
              }
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
