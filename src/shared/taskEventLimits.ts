export const MAX_TASK_TEXT_LENGTH = 100_000;
export const MAX_TOOL_RESULT_TEXT_LENGTH = 256 * 1024;

const TRUNCATED_TOOL_RESULT_NOTICE =
  "\n…[输出过长，界面仅显示末尾内容]";

export function summarizeTaskToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_TEXT_LENGTH) {
    return content;
  }
  return (
    content.slice(
      -(
        MAX_TOOL_RESULT_TEXT_LENGTH -
        TRUNCATED_TOOL_RESULT_NOTICE.length
      ),
    ) + TRUNCATED_TOOL_RESULT_NOTICE
  );
}
