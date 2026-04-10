export interface JsonRpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown> | null;
}

export interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown> | null;
}

export interface JsonRpcResponse {
  id: string;
  result: unknown;
}

export interface JsonRpcError {
  id: string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse
  | JsonRpcError;

export interface InitializeParams {
  clientInfo: {
    name: string;
    version: string;
  };
  capabilities: {
    experimentalApi: boolean;
  };
}

export interface ThreadResumeParams {
  threadId: string;
}

export interface ThreadStartParams {
  model?: string | null;
  modelProvider?: string | null;
  cwd?: string | null;
  approvalPolicy?: string | null;
  sandbox?: string | null;
  ephemeral?: boolean | null;
}

export interface ThreadListParams {
  cursor?: string | null;
  limit?: number | null;
  sortKey?: string | null;
  archived?: boolean | null;
  cwd?: string | null;
  searchTerm?: string | null;
}

export interface UserInputText {
  type: "text";
  text: string;
  textElements: [];
}

export interface TurnStartParams {
  threadId: string;
  input: UserInputText[];
}

export interface Turn {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error?: {
    message?: string;
  };
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
}

export interface ThreadResumeResult {
  thread: { id: string; [key: string]: unknown };
  model?: string;
  modelProvider?: string;
  cwd?: string;
}

export interface ThreadStartResult {
  thread: { id: string; [key: string]: unknown };
  model?: string;
  modelProvider?: string;
  cwd?: string;
}

export interface ThreadListResult {
  data: Array<{ id: string; [key: string]: unknown }>;
  nextCursor?: string | null;
}

export interface TurnStartResult {
  turn: Turn;
}

export interface ThreadReadParams {
  threadId: string;
  includeTurns: boolean;
}

export interface ThreadItemBase {
  type: string;
  id?: string;
  text?: string;
  summary?: unknown[];
  content?: unknown[];
  command?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  status?: string;
  changes?: unknown[];
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  query?: string;
}

export interface AgentMessageItem extends ThreadItemBase {
  type: "agentMessage";
  text: string;
}

export interface ThreadTurn {
  id: string;
  items?: ThreadItemBase[];
  status?: string;
}

export interface ThreadReadResult {
  thread: {
    id: string;
    turns?: ThreadTurn[];
  };
}

export interface AgentMessageDeltaParams {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface PlanDeltaParams {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ItemCompletedParams {
  threadId: string;
  turnId: string;
  item: ThreadItemBase;
}

export interface ItemStartedParams {
  threadId: string;
  turnId: string;
  item: ThreadItemBase;
}

export interface TurnPlanStep {
  step: string;
  status: "pending" | "inProgress" | "completed";
}

export interface TurnPlanUpdatedParams {
  threadId: string;
  turnId: string;
  explanation?: string | null;
  plan: TurnPlanStep[];
}

export interface ThreadTokenUsageUpdatedParams {
  threadId: string;
  turnId: string;
  tokenUsage: {
    total: {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
    };
  };
}

export interface TurnCompletedParams {
  threadId: string;
  turn: Turn;
}

export interface ErrorNotificationParams {
  error: { message: string };
  willRetry: boolean;
  threadId: string;
  turnId: string;
}

export const WIRE = {
  INITIALIZED: "initialized",
  THREAD_START: "thread/start",
  THREAD_RESUME: "thread/resume",
  THREAD_LIST: "thread/list",
  THREAD_READ: "thread/read",
  THREAD_TOKEN_USAGE_UPDATED: "thread/tokenUsage/updated",
  TURN_START: "turn/start",
  TURN_COMPLETED: "turn/completed",
  TURN_STARTED: "turn/started",
  TURN_PLAN_UPDATED: "turn/plan/updated",
  ITEM_COMPLETED: "item/completed",
  ITEM_STARTED: "item/started",
  AGENT_MESSAGE_DELTA: "item/agentMessage/delta",
  PLAN_DELTA: "item/plan/delta",
  ERROR: "error",
  COMMAND_EXEC_REQUEST_APPROVAL: "item/commandExecution/requestApproval",
  FILE_CHANGE_REQUEST_APPROVAL: "item/fileChange/requestApproval",
  TOOL_REQUEST_USER_INPUT: "item/tool/requestUserInput",
  MCP_SERVER_ELICITATION_REQUEST: "mcpServer/elicitation/request",
  PERMISSIONS_REQUEST_APPROVAL: "item/permissions/requestApproval",
  DYNAMIC_TOOL_CALL: "item/tool/call",
  CHATGPT_AUTH_TOKENS_REFRESH: "account/chatgptAuthTokens/refresh"
} as const;

export type WireMethod = (typeof WIRE)[keyof typeof WIRE];

let nextIdValue = 1;

export function nextRequestId(): string {
  return String(nextIdValue++);
}

export function resetRequestIds(): void {
  nextIdValue = 1;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isResponse(msg: unknown): msg is JsonRpcResponse {
  return (
    isObject(msg) &&
    typeof msg.id === "string" &&
    "result" in msg &&
    !("method" in msg)
  );
}

export function isError(msg: unknown): msg is JsonRpcError {
  return (
    isObject(msg) &&
    typeof msg.id === "string" &&
    isObject(msg.error) &&
    typeof msg.error.code === "number" &&
    typeof msg.error.message === "string" &&
    !("method" in msg)
  );
}

export function isNotification(msg: unknown): msg is JsonRpcNotification {
  return (
    isObject(msg) &&
    typeof msg.method === "string" &&
    !("id" in msg)
  );
}

export function isServerRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    isObject(msg) &&
    typeof msg.id === "string" &&
    typeof msg.method === "string" &&
    !("result" in msg) &&
    !("error" in msg)
  );
}

export function isThreadResumeResult(value: unknown): value is ThreadResumeResult {
  return (
    isObject(value) &&
    isObject(value.thread) &&
    typeof value.thread.id === "string"
  );
}

export function isThreadStartResult(value: unknown): value is ThreadStartResult {
  return (
    isObject(value) &&
    isObject(value.thread) &&
    typeof value.thread.id === "string"
  );
}

export function isThreadListResult(value: unknown): value is ThreadListResult {
  return (
    isObject(value) &&
    Array.isArray(value.data) &&
    value.data.every((item) => isObject(item) && typeof item.id === "string") &&
    (!("nextCursor" in value) || value.nextCursor === null || typeof value.nextCursor === "string")
  );
}

export function isTurnStartResult(value: unknown): value is TurnStartResult {
  return (
    isObject(value) &&
    isObject(value.turn) &&
    typeof value.turn.id === "string" &&
    typeof value.turn.status === "string"
  );
}

export function isThreadReadResult(value: unknown): value is ThreadReadResult {
  return (
    isObject(value) &&
    isObject(value.thread) &&
    typeof value.thread.id === "string"
  );
}

export function isTurnCompletedParams(value: unknown): value is TurnCompletedParams {
  return (
    isObject(value) &&
    typeof value.threadId === "string" &&
    isObject(value.turn) &&
    typeof value.turn.id === "string" &&
    typeof value.turn.status === "string"
  );
}

export function isErrorNotificationParams(value: unknown): value is ErrorNotificationParams {
  return (
    isObject(value) &&
    isObject(value.error) &&
    typeof value.error.message === "string" &&
    typeof value.willRetry === "boolean" &&
    typeof value.threadId === "string" &&
    typeof value.turnId === "string"
  );
}

export function isAgentMessageDeltaParams(value: unknown): value is AgentMessageDeltaParams {
  return (
    isObject(value) &&
    typeof value.threadId === "string" &&
    typeof value.turnId === "string" &&
    typeof value.itemId === "string" &&
    typeof value.delta === "string"
  );
}

export function isItemCompletedParams(value: unknown): value is ItemCompletedParams {
  return (
    isObject(value) &&
    typeof value.threadId === "string" &&
    typeof value.turnId === "string" &&
    isObject(value.item) &&
    typeof value.item.type === "string"
  );
}

export function isItemStartedParams(value: unknown): value is ItemStartedParams {
  return (
    isObject(value) &&
    typeof value.threadId === "string" &&
    typeof value.turnId === "string" &&
    isObject(value.item) &&
    typeof value.item.type === "string"
  );
}

export function isTurnPlanUpdatedParams(value: unknown): value is TurnPlanUpdatedParams {
  return (
    isObject(value) &&
    typeof value.threadId === "string" &&
    typeof value.turnId === "string" &&
    Array.isArray(value.plan) &&
    value.plan.every(
      (step) =>
        isObject(step) &&
        typeof step.step === "string" &&
        typeof step.status === "string"
    )
  );
}

export function isThreadTokenUsageUpdatedParams(
  value: unknown
): value is ThreadTokenUsageUpdatedParams {
  return (
    isObject(value) &&
    typeof value.threadId === "string" &&
    typeof value.turnId === "string" &&
    isObject(value.tokenUsage) &&
    isObject(value.tokenUsage.total) &&
    typeof value.tokenUsage.total.inputTokens === "number" &&
    typeof value.tokenUsage.total.cachedInputTokens === "number" &&
    typeof value.tokenUsage.total.outputTokens === "number"
  );
}

export function isAgentMessageItem(item: unknown): item is AgentMessageItem {
  return (
    isObject(item) &&
    item.type === "agentMessage" &&
    typeof item.text === "string"
  );
}
