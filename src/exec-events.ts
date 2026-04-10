import type {
  ThreadItemBase,
  ThreadTokenUsageUpdatedParams,
  TurnPlanUpdatedParams
} from "./protocol";

export type Usage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
};

export type ThreadError = {
  message: string;
};

export type AgentMessageItem = {
  id: string;
  type: "agent_message";
  text: string;
};

export type ReasoningItem = {
  id: string;
  type: "reasoning";
  text: string;
};

export type CommandExecutionItem = {
  id: string;
  type: "command_execution";
  command: string;
  aggregated_output: string;
  exit_code?: number;
  status: "in_progress" | "completed" | "failed" | "declined";
};

export type FileUpdateChange = {
  path: string;
  kind: "add" | "delete" | "update";
};

export type FileChangeItem = {
  id: string;
  type: "file_change";
  changes: FileUpdateChange[];
  status: "in_progress" | "completed" | "failed";
};

export type McpToolCallItem = {
  id: string;
  type: "mcp_tool_call";
  server: string;
  tool: string;
  arguments: unknown;
  result?: unknown;
  error?: { message: string };
  status: "in_progress" | "completed" | "failed";
};

export type WebSearchItem = {
  id: string;
  type: "web_search";
  query: string;
};

export type ErrorItem = {
  id: string;
  type: "error";
  message: string;
};

export type TodoItem = {
  text: string;
  completed: boolean;
};

export type TodoListItem = {
  id: string;
  type: "todo_list";
  items: TodoItem[];
};

export type ThreadItem =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | WebSearchItem
  | TodoListItem
  | ErrorItem;

export type ThreadEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; usage: Usage }
  | { type: "turn.failed"; error: ThreadError }
  | { type: "item.started"; item: ThreadItem }
  | { type: "item.updated"; item: ThreadItem }
  | { type: "item.completed"; item: ThreadItem }
  | { type: "error"; message: string };

export function zeroUsage(): Usage {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0
  };
}

export function usageFromThreadTokenUsage(params: ThreadTokenUsageUpdatedParams): Usage {
  return {
    input_tokens: params.tokenUsage.total.inputTokens,
    cached_input_tokens: params.tokenUsage.total.cachedInputTokens,
    output_tokens: params.tokenUsage.total.outputTokens
  };
}

export function todoListFromPlan(turnId: string, params: TurnPlanUpdatedParams): TodoListItem {
  return {
    id: `todo:${turnId}`,
    type: "todo_list",
    items: params.plan.map((step) => ({
      text: step.step,
      completed: step.status === "completed"
    }))
  };
}

export function mapRawThreadItem(item: ThreadItemBase): ThreadItem | null {
  const id = typeof item.id === "string" && item.id ? item.id : `unknown:${item.type}`;

  switch (item.type) {
    case "agentMessage":
      return {
        id,
        type: "agent_message",
        text: typeof item.text === "string" ? item.text : ""
      };
    case "reasoning": {
      const summary = Array.isArray(item.summary)
        ? item.summary.filter((value): value is string => typeof value === "string")
        : [];
      const content = Array.isArray(item.content)
        ? item.content.filter((value): value is string => typeof value === "string")
        : [];
      const text = [...summary, ...content].join("\n").trim();
      if (!text) {
        return null;
      }
      return {
        id,
        type: "reasoning",
        text
      };
    }
    case "commandExecution":
      return {
        id,
        type: "command_execution",
        command: typeof item.command === "string" ? item.command : "",
        aggregated_output:
          typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "",
        exit_code:
          typeof item.exitCode === "number" ? item.exitCode : undefined,
        status: mapCommandExecutionStatus(item.status)
      };
    case "fileChange":
      return {
        id,
        type: "file_change",
        changes: Array.isArray(item.changes)
          ? item.changes
              .map((change) => mapFileUpdateChange(change))
              .filter((change): change is FileUpdateChange => change !== null)
          : [],
        status: mapFileChangeStatus(item.status)
      };
    case "mcpToolCall":
      return {
        id,
        type: "mcp_tool_call",
        server: typeof item.server === "string" ? item.server : "",
        tool: typeof item.tool === "string" ? item.tool : "",
        arguments: item.arguments,
        result: item.result ?? undefined,
        error: isMessageRecord(item.error) ? { message: item.error.message } : undefined,
        status: mapToolStatus(item.status)
      };
    case "webSearch":
      return {
        id,
        type: "web_search",
        query: typeof item.query === "string" ? item.query : ""
      };
    default:
      return null;
  }
}

function mapCommandExecutionStatus(
  status: unknown
): CommandExecutionItem["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "declined":
      return "declined";
    default:
      return "in_progress";
  }
}

function mapFileChangeStatus(status: unknown): FileChangeItem["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
    case "declined":
      return "failed";
    default:
      return "in_progress";
  }
}

function mapToolStatus(status: unknown): McpToolCallItem["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "in_progress";
  }
}

function mapFileUpdateChange(change: unknown): FileUpdateChange | null {
  if (typeof change !== "object" || change === null) {
    return null;
  }

  const candidate = change as { path?: unknown; kind?: unknown };
  if (typeof candidate.path !== "string") {
    return null;
  }

  return {
    path: candidate.path,
    kind: mapPatchKind(candidate.kind)
  };
}

function mapPatchKind(kind: unknown): FileUpdateChange["kind"] {
  if (kind === "add" || kind === "delete") {
    return kind;
  }
  return "update";
}

function isMessageRecord(value: unknown): value is { message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  );
}
