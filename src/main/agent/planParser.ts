import { z } from "zod";

const taskPlanSchema = z
  .object({
    title: z.string().min(1).max(120),
    steps: z
      .array(
        z
          .object({
            title: z.string().min(1).max(120),
            completionCriteria: z.string().min(1).max(240),
            estimateSeconds: z.number().int().min(5).max(7_200),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

export type ParsedTaskPlan = z.infer<typeof taskPlanSchema>;

export class InvalidTaskPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskPlanError";
  }
}

export function parseTaskPlan(content: string): ParsedTaskPlan {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new InvalidTaskPlanError("模型返回的任务计划不是有效 JSON。");
  }
  const result = taskPlanSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidTaskPlanError(
      `模型返回的任务计划不符合要求：${result.error.issues[0]?.message ?? "未知错误"}`,
    );
  }
  return result.data;
}

export const PLANNING_SYSTEM_PROMPT = `你是 ZoroCoding 的任务规划器。
只返回一个 JSON 对象，不要使用 Markdown、代码围栏或解释文字。
结构必须为：
{"title":"简短任务标题","steps":[{"title":"可执行步骤","completionCriteria":"可观察的完成条件","estimateSeconds":120}]}
要求：1 到 12 个步骤；每步预计 5 到 7200 秒；计划必须覆盖检查、修改和验证。`;

export const READ_ONLY_PLANNING_SYSTEM_PROMPT = `你是 ZoroCoding 的项目只读任务规划器。
只返回一个 JSON 对象，不要使用 Markdown、代码围栏或解释文字。
结构必须为：
{"title":"简短任务标题","steps":[{"title":"可执行步骤","completionCriteria":"可观察的完成条件","estimateSeconds":120}]}
要求：1 到 12 个步骤；每步预计 5 到 7200 秒；计划只能覆盖列出、搜索和读取项目文件以及解释发现；不得修改文件、运行命令或声称已执行这些操作。`;

export const PLAN_REPAIR_PROMPT =
  "上一个回复不是有效的任务计划。请严格按要求只返回 JSON 对象，不要附加任何文字。";
