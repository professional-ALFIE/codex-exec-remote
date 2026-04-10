#!/usr/bin/env bun

import {
  WIRE,
  isAgentMessageDeltaParams,
  isErrorNotificationParams,
  isItemCompletedParams,
  isNotification,
  isServerRequest,
  isThreadReadResult,
  isThreadResumeResult,
  isTurnCompletedParams,
  isTurnStartResult
} from "./protocol";
import { AppServerClient } from "./client";
import { createOutput, extractCanonicalOutput } from "./output";

type ServeArgs = {
  command: "serve";
  listen: string;
  codexBin: string;
};

type ResumeArgs = {
  command: "resume";
  threadId: string;
  prompt: string;
  remote: string;
  authTokenEnv?: string;
  json: boolean;
  timeoutSec: number;
  codexBin: string;
};

type CliArgs = ServeArgs | ResumeArgs | { command: "help" };

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
      runResume(parsed, output, authToken).finally(() => {
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

  async function runResume(
    args: ResumeArgs,
    sink: ReturnType<typeof createOutput>,
    token?: string
  ): Promise<number> {
    client = await AppServerClient.connect({
      url: args.remote,
      authToken: token,
      onWarning: sink.warn
    });

    sink.info(`connected to ${args.remote}`);
    if (args.json) {
      sink.jsonEvent({ type: "connected", url: args.remote });
      sink.jsonEvent({ type: "initialized" });
    } else {
      sink.info("initialized");
    }

    const resumeRaw = await client.request(WIRE.THREAD_RESUME, {
      threadId: args.threadId
    });
    if (!isThreadResumeResult(resumeRaw)) {
      throw new Error("thread/resume returned unexpected shape");
    }
    sink.info(`thread resumed: ${resumeRaw.thread.id}`);
    if (args.json) {
      sink.jsonEvent({ type: "threadResumed", thread: resumeRaw.thread });
    }

    const turnStartRaw = await client.request(WIRE.TURN_START, {
      threadId: args.threadId,
      input: [{ type: "text", text: args.prompt, textElements: [] }]
    });
    if (!isTurnStartResult(turnStartRaw)) {
      throw new Error("turn/start returned unexpected shape");
    }

    const targetTurnId = turnStartRaw.turn.id;
    sink.info(`turn started: ${targetTurnId}`);
    if (args.json) {
      sink.jsonEvent({ type: "turnStarted", turn: turnStartRaw.turn });
    }

    const assistantMessages: string[] = [];
    let deltaAccumulated = "";

    while (true) {
      const event = await client.nextEvent();

      if (isServerRequest(event)) {
        client.rejectServerRequest(
          event.id,
          -32601,
          `codex-exec-remote: non-interactive mode, rejecting ${event.method}`
        );
        sink.error(`server request rejected: ${event.method}`);
        return 1;
      }

      if (!isNotification(event)) {
        continue;
      }

      const method = event.method;
      const params = event.params;

      if (isObjectWithThreadId(params) && params.threadId !== args.threadId) {
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
        if (args.json) {
          sink.jsonEvent({ type: "turnCompleted", turn: params.turn });
        }

        if (params.turn.status !== "completed") {
          const errMsg = params.turn.error?.message ?? params.turn.status;
          sink.error(`turn ${params.turn.status}: ${errMsg}`);
          return 1;
        }

        try {
          const readRaw = await client.request(WIRE.THREAD_READ, {
            threadId: args.threadId,
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

        const fallback = assistantMessages.length > 0 ? assistantMessages.join("\n") : deltaAccumulated;
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

        sink.error(`fatal error: ${params.error.message}`);
        return 1;
      }

      if (!hasMatchingTurnId(params, targetTurnId)) {
        continue;
      }

      switch (method) {
        case WIRE.AGENT_MESSAGE_DELTA: {
          if (!isAgentMessageDeltaParams(params)) {
            sink.warn("received malformed item/agentMessage/delta params; skipping");
            break;
          }
          deltaAccumulated += params.delta;
          if (args.json) {
            sink.jsonEvent({ type: "notification", method, params });
          } else {
            sink.streamDelta(params.delta);
          }
          break;
        }
        case WIRE.PLAN_DELTA:
          if (args.json) {
            sink.jsonEvent({ type: "notification", method, params });
          }
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
            sink.jsonEvent({ type: "notification", method, params });
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
  const proc = Bun.spawn([args.codexBin, "app-server", "--listen", args.listen], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });
  return await proc.exited;
}

export function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h") || argv.includes("help")) {
    return { command: "help" };
  }

  if (argv.length === 0 || argv[0]?.startsWith("--")) {
    return parseServeArgs(argv);
  }

  const [command, ...rest] = argv;
  if (command === "resume") {
    return parseResumeArgs(rest);
  }

  throw new Error(`unknown command: ${command}`);
}

function parseServeArgs(tokens: string[]): ServeArgs {
  let listen = "ws://127.0.0.1:4501";
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

function parseResumeArgs(tokens: string[]): ResumeArgs {
  let remote = "ws://127.0.0.1:4501";
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
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--codex-bin") {
      codexBin = expectValue(tokens, ++index, "--codex-bin");
      continue;
    }
    positionals.push(token);
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
    threadId,
    prompt,
    remote,
    authTokenEnv,
    json,
    timeoutSec,
    codexBin
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
  process.stdout.write(
    [
      "Usage:",
      "  codex-exec-remote [--listen ws://127.0.0.1:4501] [--codex-bin codex]",
      "  codex-exec-remote resume <thread-id> \"<prompt>\" [--remote ws://127.0.0.1:4501] [--auth-token-env VAR] [--json] [--timeout 300] [--codex-bin codex]"
    ].join("\n") + "\n"
  );
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

if (import.meta.main) {
  const exitCode = await main(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[codex-exec-remote] ✗ ${message}\n`);
    return 2;
  });
  process.exit(exitCode);
}
