import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type {
  PermissionDecision,
  ToolOperation,
} from "../../shared/domain";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT"
      ? Promise.reject(error)
      : false;
  }
}

export async function canonicalizePath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  if (await exists(absolutePath)) {
    return realpath(absolutePath);
  }

  const missingSegments: string[] = [];
  let cursor = absolutePath;
  while (!(await exists(cursor))) {
    const parent = dirname(cursor);
    if (parent === cursor) {
      return absolutePath;
    }
    missingSegments.unshift(relative(parent, cursor));
    cursor = parent;
  }
  return resolve(await realpath(cursor), ...missingSegments);
}

export function isPathContained(path: string, projectRoot: string): boolean {
  const difference = relative(projectRoot, path);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

function shellReasons(command: string, projectRoot: string): string[] {
  const reasons: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [
      /(^|[;&|]\s*|\s)(sudo|doas)(\s|$)/i,
      "命令请求管理员权限",
    ],
    [
      /(^|[;&|]\s*|\s)(rm|rmdir|unlink)(\s|$)/i,
      "命令会删除文件或目录",
    ],
    [
      /(^|[;&|]\s*|\s)(diskutil|fdisk|mkfs|mount|umount)(\s|$)/i,
      "命令会操作磁盘或挂载点",
    ],
    [
      /(^|[;&|]\s*|\s)(shutdown|reboot|halt|launchctl)(\s|$)/i,
      "命令会改变系统运行状态",
    ],
    [
      /\b(npm|pnpm|yarn)\b[^\n;&|]*(\s-g\b|--global\b)/i,
      "命令会全局安装软件包",
    ],
    [
      /\b(pip|pip3)\b[^\n;&|]*(--user\b|--root\b|--prefix\b)/i,
      "命令会在项目之外安装软件包",
    ],
    [
      /(^|[;&|]\s*|\s)brew\s+(install|uninstall|upgrade|tap)(\s|$)/i,
      "命令会修改系统级 Homebrew 软件",
    ],
    [
      /\bgit\s+(push|clean)\b|\bgit\s+reset\b[^\n;&|]*--hard\b/i,
      "命令会发布或破坏性重置 Git 状态",
    ],
    [
      /(^|[\s"'=])(\/System|\/Library|\/Applications|\/etc|\/usr\/local)(\/|[\s"';&|]|$)/,
      "命令访问 macOS 系统或全局目录",
    ],
  ];

  for (const [pattern, reason] of checks) {
    if (pattern.test(command) && !reasons.includes(reason)) {
      reasons.push(reason);
    }
  }

  const redirection =
    /(?:^|[\s;|&])(?:\d?>>?|&>)[ \t]*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
  for (const match of command.matchAll(redirection)) {
    const target = match[1] ?? match[2] ?? match[3];
    if (target === undefined || target.startsWith("$")) {
      continue;
    }
    const resolvedTarget = resolve(projectRoot, target);
    if (!isPathContained(resolvedTarget, projectRoot)) {
      reasons.push("命令会把输出写到项目目录之外");
      break;
    }
  }

  if (!isAutomaticProjectCommand(command)) {
    reasons.push("命令不在自动执行白名单内，或包含复杂 Shell 语法");
  }

  return reasons;
}

function isAutomaticProjectCommand(command: string): boolean {
  const normalized = command.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 2_000 ||
    /[\n\r;&|`$><(){}[\]\\~]/.test(normalized) ||
    /(^|\s|=)\/(?!\/)/.test(normalized) ||
    /(^|[/\s])\.\.([/\s]|$)/.test(normalized) ||
    /:\/\//.test(normalized) ||
    /["']/.test(normalized)
  ) {
    return false;
  }

  const tokens = normalized.split(/\s+/);
  const [executable, subcommand, script] = tokens;
  if (
    ["npm", "pnpm", "yarn", "bun"].includes(executable) &&
    subcommand === "test"
  ) {
    return true;
  }
  if (
    ["npm", "pnpm", "yarn", "bun"].includes(executable) &&
    subcommand === "run" &&
    script !== undefined &&
    /^[a-zA-Z0-9:_-]+$/.test(script)
  ) {
    return true;
  }
  if (
    executable === "git" &&
    [
      "status",
      "diff",
      "log",
      "show",
      "branch",
      "rev-parse",
      "grep",
    ].includes(subcommand)
  ) {
    return true;
  }
  return ["pwd"].includes(executable) && tokens.length === 1;
}

export class PermissionEngine {
  async assess(
    operation: ToolOperation,
    projectRoot: string,
  ): Promise<PermissionDecision> {
    const canonicalProjectRoot = await canonicalizePath(projectRoot);

    if (operation.kind === "shell") {
      const reasons = shellReasons(operation.command, canonicalProjectRoot);
      return reasons.length === 0
        ? {
            level: "allow",
            summary: "运行项目命令",
            reasons: [],
          }
        : {
            level: "ask",
            summary: `确认运行高风险命令：${operation.command}`,
            reasons,
          };
    }

    const candidate = isAbsolute(operation.path)
      ? operation.path
      : resolve(canonicalProjectRoot, operation.path);
    const canonicalTarget = await canonicalizePath(candidate);
    const reasons: string[] = [];

    if (!isPathContained(canonicalTarget, canonicalProjectRoot)) {
      reasons.push("目标路径位于当前项目目录之外");
    }
    if (operation.kind === "delete_path") {
      reasons.push("该操作会删除文件或目录");
    }

    if (reasons.length > 0) {
      return {
        level: "ask",
        summary:
          operation.kind === "delete_path"
            ? `确认删除：${operation.path}`
            : `确认访问项目外路径：${operation.path}`,
        reasons,
        canonicalTarget,
      };
    }

    return {
      level: "allow",
      summary:
        operation.kind === "read_file" ? "读取项目文件" : "修改项目文件",
      reasons: [],
      canonicalTarget,
    };
  }
}
