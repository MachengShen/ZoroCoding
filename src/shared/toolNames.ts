export const TOOL_NAME_VALUES = [
  "list_files",
  "read_file",
  "search_files",
  "write_file",
  "run_shell",
] as const;

export type ToolName = (typeof TOOL_NAME_VALUES)[number];
