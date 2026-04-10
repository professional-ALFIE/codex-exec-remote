#!/usr/bin/env bun

import { basename } from "node:path";
import { AppServerClient } from "./client";
import {
  mapRawThreadItem,
  todoListFromPlan,
  type TodoListItem,
  usageFromThreadTokenUsage,
  zeroUsage
} from "./exec-events";
import { createOutput, extractCanonicalOutput } from "./output";
import {
  WIRE,
  isAgentMessageDeltaParams,
  isErrorNotificationParams,
  isItemCompletedParams,
  isItemStartedParams,
  isNotification,
  isServerRequest,
  isThreadListResult,
  isThreadReadResult,
  isThreadResumeResult,
  isThreadStartResult,
  isThreadTokenUsageUpdatedParams,
  isTurnCompletedParams,
  isTurnPlanUpdatedParams,
  isTurnStartResult
} from "./protocol";

type ServeArgs = {
  command: "serve";
  listen: string;
  codexBin: string;
};

type PromptArgsBase = {
  remote: string;
  authTokenEnv?: string;
  json: boolean;
  timeoutSec: number;
  codexBin: string;
};

type StartArgs = PromptArgsBase & {
  command: "start";
  prompt: string;
};

type ResumeArgs = PromptArgsBase & {
  command: "resume";
  prompt: string;
  threadId?: string;
  last: boolean;
};

type PromptArgs = StartArgs | ResumeArgs;
type CliArgs = ServeArgs | PromptArgs | { command: "help" };

const DEFAULT_REMOTE = "ws://127.0.0.1:4501";
const SELF_EXECUTABLE_NAMES = new Set(["codex-exec-remote", "cer"]);

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.command === "help") {
    printUsage();
    return 0;
  }

  if (parsed.command === "serve") {
    return await runServe(parsed);
  }

  const output = createOutput(parsed.json);
  let authToken: string | undefined;
  if (parsed.authTokenEnv) {
    authToken = process.env[parsed.authTokenEnv];
    if (!authToken) {
      output.error(`environment variable ${parsed.authTokenEnv} is empty or not set`);
      return 2;
    }
  }

  let client: AppServerClient | undefined;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("timeout exceeded")), parsed.timeoutSec * 1000);
  });

  try {
    const exitCode = await Promise.race([
      runPromptCommand(parsed, output, authToken).finally(() => {
        client?.close();
      }),
      timeout
    ]);
    return exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "timeout exceeded") {
      output.error(message);
      return 124;
    }
    output.error(message);
    return 1;
  }

  async function runPromptCommand(
    args: PromptArgs,
    sink: ReturnType<typeof createOutput>,
    token?: string
  ): Promise<number> {
    client = await AppServerClient.connect({
      url: args.remote,
      authToken: token,
      onWarning: sink.warn
    });

    sink.info(`connected to ${args.remote}`);
    sink.info("initialized");

    const threadId = await ensureTargetThread(args, sink);
    return await runTurn(args, threadId, sink);
  }

  async function ensureTargetThread(
    args: PromptArgs,
    sink: ReturnType<typeof createOutput>
  ): Promise<string> {
    if (args.command === "start") {
      const startRaw = await client!.request(WIRE.THREAD_START, {});
      if (!isThreadStartResult(startRaw)) {
        throw new Error("thread/start returned unexpected shape");
      }
      const threadId = startRaw.thread.id;
      sink.info(`thread started: ${threadId}`);
      if (args.json) {
        sink.jsonEvent({ type: "thread.started", thread_id: threadId });
      }
      return threadId;
    }

    const resolvedThreadId = args.last ? await findMostRecentThreadId() : args.threadId;
    if (!resolvedThreadId) {
      throw new Error("resume --last found no recent thread");
    }

    const resumeRaw = await client!.request(WIRE.THREAD_RESUME, {
      threadId: resolvedThreadId
    });
    if (!isThreadResumeResult(resumeRaw)) {
      throw new Error("thread/resume returned unexpected shape");
    }

    const threadId = resumeRaw.thread.id;
    sink.info(`thread resumed: ${threadId}`);
    if (args.json) {
      sink.jsonEvent({ type: "thread.started", thread_id: threadId });
    }
    return threadId;
  }

  async function findMostRecentThreadId(): Promise<string | null> {
    let cursor: string | null | undefined = null;

    while (true) {
      const listRaw = await client!.request(WIRE.THREAD_LIST, {
        cursor,
        limit: 100,
        sortKey: "updated_at",
        archived: false
      });

      if (!isThreadListResult(listRaw)) {
        throw new Error("thread/list returned unexpected shape");
      }

      const first = listRaw.data[0];
      if (first?.id) {
        return first.id;
      }

      if (!listRaw.nextCursor) {
        return null;
      }
      cursor = listRaw.nextCursor;
    }
  }

  async function runTurn(
    args: PromptArgs,
    threadId: string,
    sink: ReturnType<typeof createOutput>
  ): Promise<number> {
    const turnStartRaw = await client!.request(WIRE.TURN_START, {
      threadId,
      input: [{ type: "text", text: args.prompt, textElements: [] }]
    });
    if (!isTurnStartResult(turnStartRaw)) {
      throw new Error("turn/start returned unexpected shape");
    }

    const targetTurnId = turnStartRaw.turn.id;
    sink.info(`turn started: ${targetTurnId}`);
    if (args.json) {
      sink.jsonEvent({ type: "turn.started" });
    }

    const assistantMessages: string[] = [];
    let deltaAccumulated = "";
    let lastUsage = zeroUsage();
    let runningTodoList: TodoListItem | null = null;

    while (true) {
      const event = await client!.nextEvent();

      if (isServerRequest(event)) {
        client!.approveServerRequest(event.id);
        sink.info(`auto-approved server request: ${event.method}`);
        continue;
      }

      if (!isNotification(event)) {
        continue;
      }

      const method = event.method;
      const params = event.params;

      if (isObjectWithThreadId(params) && params.threadId !== threadId) {
        continue;
      }

      if (method === WIRE.THREAD_TOKEN_USAGE_UPDATED) {
        if (!isThreadTokenUsageUpdatedParams(params)) {
          sink.warn("received malformed thread/tokenUsage/updated params; skipping");
          continue;
        }
        if (params.turnId !== targetTurnId) {
          continue;
        }
        lastUsage = usageFromThreadTokenUsage(params);
        continue;
      }

      if (method === WIRE.TURN_PLAN_UPDATED) {
        if (!isTurnPlanUpdatedParams(params)) {
          sink.warn("received malformed turn/plan/updated params; skipping");
          continue;
        }
        if (params.turnId !== targetTurnId) {
          continue;
        }

        const hadTodoList = runningTodoList !== null;
        const todoList = todoListFromPlan(targetTurnId, params);
        runningTodoList = todoList;

        if (args.json) {
          sink.jsonEvent({
            type: hadTodoList ? "item.updated" : "item.started",
            item: todoList
          });
        }
        continue;
      }

      if (method === WIRE.TURN_COMPLETED) {
        if (!isTurnCompletedParams(params)) {
          sink.warn("received malformed turn/completed params; skipping");
          continue;
        }
        if (params.turn.id !== targetTurnId) {
          continue;
        }

        sink.info(`turn completed (status: ${params.turn.status})`);

        if (args.json && runningTodoList) {
          sink.jsonEvent({
            type: "item.completed",
            item: runningTodoList
          });
          runningTodoList = null;
        }

        if (params.turn.status !== "completed") {
          const errMsg = params.turn.error?.message ?? params.turn.status;
          if (args.json) {
            sink.jsonEvent({
              type: "turn.failed",
              error: { message: errMsg }
            });
          }
          sink.error(`turn ${params.turn.status}: ${errMsg}`);
          return 1;
        }

        if (args.json) {
          sink.jsonEvent({
            type: "turn.completed",
            usage: lastUsage
          });
          return 0;
        }

        try {
          const readRaw = await client!.request(WIRE.THREAD_READ, {
            threadId,
            includeTurns: true
          });
          if (!isThreadReadResult(readRaw)) {
            sink.warn("thread/read returned unexpected shape; using fallback");
          } else {
            const canonical = extractCanonicalOutput(readRaw, targetTurnId);
            if (canonical) {
              sink.finalOutput(canonical);
              return 0;
            }
            sink.warn("thread/read returned no matching turn items; using fallback");
          }
        } catch (error) {
          sink.warn(`thread/read failed: ${String(error)}`);
        }

        const fallback =
          assistantMessages.length > 0 ? assistantMessages.join("\n") : deltaAccumulated;
        sink.finalOutput(fallback);
        return 0;
      }

      if (method === WIRE.ERROR) {
        if (!isErrorNotificationParams(params)) {
          sink.warn("received malformed error notification; skipping");
          continue;
        }
        if (params.turnId !== targetTurnId) {
          continue;
        }

        if (params.willRetry) {
          sink.warn(`transient error (will retry): ${params.error.message}`);
          continue;
        }

        if (args.json) {
          sink.jsonEvent({
            type: "error",
            message: params.error.message
          });
        }
        sink.error(`fatal error: ${params.error.message}`);
        return 1;
      }

      if (!hasMatchingTurnId(params, targetTurnId)) {
        continue;
      }

      switch (method) {
        case WIRE.ITEM_STARTED: {
          if (!isItemStartedParams(params)) {
            sink.warn("received malformed item/started params; skipping");
            break;
          }
          if (args.json) {
            const mapped = mapRawThreadItem(params.item);
            if (mapped) {
              sink.jsonEvent({
                type: "item.started",
                item: mapped
              });
            }
          }
          break;
        }
        case WIRE.AGENT_MESSAGE_DELTA: {
          if (!isAgentMessageDeltaParams(params)) {
            sink.warn("received malformed item/agentMessage/delta params; skipping");
            break;
          }
          deltaAccumulated += params.delta;
          if (!args.json) {
            sink.streamDelta(params.delta);
          }
          break;
        }
        case WIRE.PLAN_DELTA:
          break;
        case WIRE.ITEM_COMPLETED: {
          if (!isItemCompletedParams(params)) {
            sink.warn("received malformed item/completed params; skipping");
            break;
          }
          const item = params.item;
          if (isAgentMessageItem(item)) {
            assistantMessages.push(item.text);
          }
          if (args.json) {
            const mapped = mapRawThreadItem(item);
            if (mapped) {
              sink.jsonEvent({
                type: "item.completed",
                item: mapped
              });
            }
          }
          break;
        }
        default:
          sink.warn(`ignoring unsupported notification: ${method}`);
          break;
      }
    }
  }
}

async function runServe(args: ServeArgs): Promise<number> {
  const proc = Bun.spawn([
    args.codexBin,
    "--dangerously-bypass-approvals-and-sandbox",
    "app-server",
    "--listen",
    args.listen
  ], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });
  return await proc.exited;
}

export function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
    return { command: "help" };
  }

  if (argv.length === 0 || argv[0]?.startsWith("--")) {
    return parseServeArgs(argv);
  }

  const [command, ...rest] = argv;
  if (command === "serve") {
    return parseServeArgs(rest);
  }
  if (command === "start") {
    return parseStartArgs(rest);
  }
  if (command === "resume") {
    return parseResumeArgs(rest);
  }

  throw new Error(`unknown command: ${command}`);
}

function parseServeArgs(tokens: string[]): ServeArgs {
  let listen = DEFAULT_REMOTE;
  let codexBin = "codex";

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--listen") {
      listen = expectValue(tokens, ++index, "--listen");
      continue;
    }
    if (token === "--codex-bin") {
      codexBin = expectValue(tokens, ++index, "--codex-bin");
      continue;
    }
    throw new Error(`unknown option for serve mode: ${token}`);
  }

  return { command: "serve", listen, codexBin };
}

function parseStartArgs(tokens: string[]): StartArgs {
  const shared = parsePromptFlags(tokens);
  if (shared.positionals.length < 1) {
    throw new Error("start requires <prompt>");
  }

  return {
    command: "start",
    prompt: shared.positionals.join(" ").trim(),
    remote: shared.remote,
    authTokenEnv: shared.authTokenEnv,
    json: shared.json,
    timeoutSec: shared.timeoutSec,
    codexBin: shared.codexBin
  };
}

function parseResumeArgs(tokens: string[]): ResumeArgs {
  const shared = parsePromptFlags(tokens);
  let last = false;
  const positionals: string[] = [];

  for (const token of shared.positionals) {
    if (token === "--last" || token === "-l") {
      last = true;
      continue;
    }
    positionals.push(token);
  }

  if (last) {
    if (positionals.length < 1) {
      throw new Error("resume --last requires <prompt>");
    }
    return {
      command: "resume",
      last: true,
      threadId: undefined,
      prompt: positionals.join(" ").trim(),
      remote: shared.remote,
      authTokenEnv: shared.authTokenEnv,
      json: shared.json,
      timeoutSec: shared.timeoutSec,
      codexBin: shared.codexBin
    };
  }

  if (positionals.length < 2) {
    throw new Error("resume requires <thread-id> and <prompt>");
  }

  const [threadId, ...promptParts] = positionals;
  const prompt = promptParts.join(" ").trim();
  if (!threadId || !prompt) {
    throw new Error("resume requires <thread-id> and <prompt>");
  }

  return {
    command: "resume",
    last: false,
    threadId,
    prompt,
    remote: shared.remote,
    authTokenEnv: shared.authTokenEnv,
    json: shared.json,
    timeoutSec: shared.timeoutSec,
    codexBin: shared.codexBin
  };
}

function parsePromptFlags(tokens: string[]): {
  remote: string;
  authTokenEnv?: string;
  json: boolean;
  timeoutSec: number;
  codexBin: string;
  positionals: string[];
} {
  let remote = DEFAULT_REMOTE;
  let authTokenEnv: string | undefined;
  let json = false;
  let timeoutSec = 300;
  let codexBin = "codex";
  const positionals: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--remote") {
      remote = expectValue(tokens, ++index, "--remote");
      continue;
    }
    if (token === "--auth-token-env") {
      authTokenEnv = expectValue(tokens, ++index, "--auth-token-env");
      continue;
    }
    if (token === "--timeout") {
      const raw = expectValue(tokens, ++index, "--timeout");
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`invalid --timeout value: ${raw}`);
      }
      timeoutSec = parsed;
      continue;
    }
    if (token === "--json" || token === "-j") {
      json = true;
      continue;
    }
    if (token === "--codex-bin") {
      codexBin = expectValue(tokens, ++index, "--codex-bin");
      continue;
    }
    positionals.push(token);
  }

  return {
    remote,
    authTokenEnv,
    json,
    timeoutSec,
    codexBin,
    positionals
  };
}

function expectValue(tokens: string[], index: number, flag: string): string {
  const value = tokens[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printUsage(): void {
  process.stdout.write(`codex-exec-remote (cer) — Remote execution bridge for Codex app-server

⚠️  Full permission mode. All server requests are auto-approved.

Usage: codex-exec-remote [OPTIONS]
       codex-exec-remote <COMMAND> [ARGS]
       cer <COMMAND> [ARGS]

Commands:
  (default)                    Launch codex app-server (ws://127.0.0.1:4501)
  start "<prompt>"             Start a new thread and send a turn
  resume <id> "<prompt>"       Resume an existing thread
  resume --last "<prompt>"     Resume the most recent thread
  help                         Print this help message

Serve Options:
  --listen <url>               App-server listen address
                               [default: ws://127.0.0.1:4501]
  --codex-bin <path>           Path to codex binary
                               [default: codex]

Start / Resume Options:
  --remote <url>               App-server address to connect to
                               [default: ws://127.0.0.1:4501]
  --auth-token-env <VAR>       Read Bearer token from this env var
  -j, --json                   Emit ThreadEvent JSONL to stdout
  --timeout <sec>              Max wait time in seconds
                               [default: 300]
  --codex-bin <path>           Path to codex binary
                               [default: codex]

Resume-specific:
  -l, --last                   Resume the most recent thread

  -h, --help                   Print help

Examples:
  cer                                        Launch app-server
  cer start "hello"                          New thread
  cer resume -l "continue"                   Resume last thread
  cer start "hello" -j                       JSONL output
`);
}

function isObjectWithThreadId(value: unknown): value is { threadId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "threadId" in value &&
    typeof (value as { threadId?: unknown }).threadId === "string"
  );
}

function hasMatchingTurnId(value: unknown, targetTurnId: string): value is { turnId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "turnId" in value &&
    typeof (value as { turnId?: unknown }).turnId === "string" &&
    (value as { turnId: string }).turnId === targetTurnId
  );
}

function isAgentMessageItem(value: unknown): value is { type: "agentMessage"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "text" in value &&
    (value as { type?: unknown }).type === "agentMessage" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

export function normalizeCompiledCliArgv(argv: string[]): string[] {
  const cliArgv = argv.slice(2);
  if (cliArgv.length !== 1) {
    return cliArgv;
  }

  const [onlyArg] = cliArgv;
  if (!onlyArg) {
    return cliArgv;
  }

  return SELF_EXECUTABLE_NAMES.has(basename(onlyArg)) ? [] : cliArgv;
}

if (import.meta.main) {
  const exitCode = await main(normalizeCompiledCliArgv(process.argv)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[codex-exec-remote] ✗ ${message}\n`);
    return 2;
  });
  process.exit(exitCode);
}
