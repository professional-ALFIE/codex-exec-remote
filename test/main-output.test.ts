import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server as HttpServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { main } from "../src/index";
import { WIRE } from "../src/protocol";

let server: HttpServer | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server = undefined;
  });
});

describe("main output modes", () => {
  test("start subcommand starts a new thread and emits thread events", async () => {
    const fixture = await startAppServerFixture();

    const result = await captureProcessOutput(() =>
      main(["start", "hello world", "--remote", fixture.url, "--json"])
    );

    expect(result.exitCode).toBe(0);

    const events = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(events[0]).toEqual({
      type: "thread.started",
      thread_id: "thread-new"
    });
    expect(events.at(-1)).toEqual({
      type: "turn.completed",
      usage: {
        input_tokens: 11,
        cached_input_tokens: 2,
        output_tokens: 3
      }
    });
  });

  test("json mode emits codex exec style ThreadEvent JSONL", async () => {
    const fixture = await startAppServerFixture();

    const result = await captureProcessOutput(() =>
      main(["resume", "thread-1", "hello world", "--remote", fixture.url, "--json"])
    );

    expect(result.exitCode).toBe(0);

    const events = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(events.map((event) => event.type)).toEqual([
      "thread.started",
      "turn.started",
      "item.started",
      "item.updated",
      "item.started",
      "item.completed",
      "item.completed",
      "turn.completed"
    ]);

    expect(events[0]).toEqual({
      type: "thread.started",
      thread_id: "thread-1"
    });

    expect(events[2]).toEqual({
      type: "item.started",
      item: {
        id: "todo:turn-1",
        type: "todo_list",
        items: [
          { text: "first step", completed: false },
          { text: "second step", completed: false }
        ]
      }
    });

    expect(events[3]).toEqual({
      type: "item.updated",
      item: {
        id: "todo:turn-1",
        type: "todo_list",
        items: [
          { text: "first step", completed: true },
          { text: "second step", completed: false }
        ]
      }
    });

    expect(events[4]).toEqual({
      type: "item.started",
      item: {
        id: "msg-1",
        type: "agent_message",
        text: ""
      }
    });

    expect(events[5]).toEqual({
      type: "item.completed",
      item: {
        id: "msg-1",
        type: "agent_message",
        text: "Hello from item completion"
      }
    });

    expect(events[6]).toEqual({
      type: "item.completed",
      item: {
        id: "todo:turn-1",
        type: "todo_list",
        items: [
          { text: "first step", completed: true },
          { text: "second step", completed: false }
        ]
      }
    });

    expect(events[7]).toEqual({
      type: "turn.completed",
      usage: {
        input_tokens: 11,
        cached_input_tokens: 2,
        output_tokens: 3
      }
    });

    expect(result.stdout).not.toContain("\"type\":\"connected\"");
    expect(result.stdout).not.toContain("\"type\":\"notification\"");
    expect(result.stdout).not.toContain("\"type\":\"finalOutput\"");
    expect(result.stdout).not.toContain("\"type\":\"info\"");
    expect(result.stdout).not.toContain("\"type\":\"warning\"");
    expect(result.stdout).not.toContain("\"type\":\"delta\"");
    expect(result.stderr).not.toContain("{\"type\":");
  });

  test("non-json mode keeps final answer on stdout and logs on stderr", async () => {
    const fixture = await startAppServerFixture();

    const result = await captureProcessOutput(() =>
      main(["resume", "thread-1", "hello world", "--remote", fixture.url])
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Hello from thread read\n");
    expect(result.stderr).toContain("[codex-exec-remote] connected to");
    expect(result.stderr).toContain("[codex-exec-remote] thread resumed: thread-1");
    expect(result.stderr).not.toContain("{\"type\":");
    expect(result.stdout).not.toContain("{\"type\":");
  });

  test("resume --last resolves the most recent thread before sending a turn", async () => {
    const fixture = await startAppServerFixture();

    const result = await captureProcessOutput(() =>
      main(["resume", "--last", "hello latest", "--remote", fixture.url])
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Hello from thread read\n");
    expect(result.stderr).toContain("[codex-exec-remote] thread resumed: thread-last");
  });
});

async function startAppServerFixture(): Promise<{ url: string }> {
  server = createServer();
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket) => {
    let activeThreadId = "thread-1";
    let activeTurnId = "turn-1";

    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      const method = typeof message.method === "string" ? message.method : null;
      const id = typeof message.id === "string" ? message.id : null;

      if (method === "initialize" && id) {
        socket.send(JSON.stringify({ id, result: { ok: true } }));
        return;
      }

      if (method === WIRE.INITIALIZED) {
        return;
      }

      if (method === WIRE.THREAD_LIST && id) {
        socket.send(
          JSON.stringify({
            id,
            result: {
              data: [
                {
                  id: "thread-last"
                }
              ],
              nextCursor: null
            }
          })
        );
        return;
      }

      if (method === WIRE.THREAD_START && id) {
        activeThreadId = "thread-new";
        socket.send(
          JSON.stringify({
            id,
            result: {
              thread: { id: activeThreadId }
            }
          })
        );
        return;
      }

      if (method === WIRE.THREAD_RESUME && id) {
        const threadId =
          typeof (message.params as { threadId?: unknown } | undefined)?.threadId === "string"
            ? ((message.params as { threadId: string }).threadId)
            : "thread-1";
        activeThreadId = threadId;
        socket.send(
          JSON.stringify({
            id,
            result: {
              thread: { id: activeThreadId }
            }
          })
        );
        return;
      }

      if (method === WIRE.TURN_START && id) {
        activeTurnId =
          activeThreadId === "thread-new"
            ? "turn-new"
            : activeThreadId === "thread-last"
              ? "turn-last"
              : "turn-1";

        socket.send(
          JSON.stringify({
            id,
            result: {
              turn: { id: activeTurnId, status: "inProgress" }
            }
          })
        );

        socket.send(
          JSON.stringify({
            method: "thread/tokenUsage/updated",
            params: {
              threadId: activeThreadId,
              turnId: activeTurnId,
              tokenUsage: {
                total: {
                  totalTokens: 16,
                  inputTokens: 11,
                  cachedInputTokens: 2,
                  outputTokens: 3,
                  reasoningOutputTokens: 0
                },
                last: {
                  totalTokens: 16,
                  inputTokens: 11,
                  cachedInputTokens: 2,
                  outputTokens: 3,
                  reasoningOutputTokens: 0
                },
                modelContextWindow: null
              }
            }
          })
        );

        socket.send(
          JSON.stringify({
            method: "turn/plan/updated",
            params: {
              threadId: activeThreadId,
              turnId: activeTurnId,
              explanation: null,
              plan: [
                { step: "first step", status: "pending" },
                { step: "second step", status: "pending" }
              ]
            }
          })
        );

        socket.send(
          JSON.stringify({
            method: "turn/plan/updated",
            params: {
              threadId: activeThreadId,
              turnId: activeTurnId,
              explanation: null,
              plan: [
                { step: "first step", status: "completed" },
                { step: "second step", status: "pending" }
              ]
            }
          })
        );

        socket.send(
          JSON.stringify({
            method: WIRE.ITEM_STARTED,
            params: {
              threadId: activeThreadId,
              turnId: activeTurnId,
              item: {
                id: "msg-1",
                type: "agentMessage",
                text: ""
              }
            }
          })
        );

        socket.send(
          JSON.stringify({
            method: WIRE.AGENT_MESSAGE_DELTA,
            params: {
              threadId: activeThreadId,
              turnId: activeTurnId,
              itemId: "msg-1",
              delta: "Hello from delta"
            }
          })
        );

        socket.send(
          JSON.stringify({
            method: WIRE.ITEM_COMPLETED,
            params: {
              threadId: activeThreadId,
              turnId: activeTurnId,
              item: {
                id: "msg-1",
                type: "agentMessage",
                text: "Hello from item completion"
              }
            }
          })
        );

        socket.send(
          JSON.stringify({
            method: WIRE.TURN_COMPLETED,
            params: {
              threadId: activeThreadId,
              turn: { id: activeTurnId, status: "completed" }
            }
          })
        );
        return;
      }

      if (method === WIRE.THREAD_READ && id) {
        socket.send(
          JSON.stringify({
            id,
            result: {
              thread: {
                id: activeThreadId,
                turns: [
                  {
                    id: activeTurnId,
                    items: [
                      {
                        id: "msg-1",
                        type: "agentMessage",
                        text: "Hello from thread read"
                      }
                    ]
                  }
                ]
              }
            }
          })
        );
      }
    });
  });

  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server address unavailable");
  }

  return { url: `ws://127.0.0.1:${address.port}` };
}

async function captureProcessOutput(run: () => Promise<number>): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  let stdout = "";
  let stderr = "";

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalStderrIsTTY = process.stderr.isTTY;

  const captureWrite = (bucket: "stdout" | "stderr") =>
    ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
      const text =
        typeof chunk === "string"
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString()
            : String(chunk);

      if (bucket === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }

      const maybeCallback =
        typeof encoding === "function"
          ? encoding
          : typeof callback === "function"
            ? callback
            : null;
      maybeCallback?.();
      return true;
    }) as typeof process.stdout.write;

  process.stdout.write = captureWrite("stdout");
  process.stderr.write = captureWrite("stderr");
  // Simulate redirected (non-TTY) environment so finalOutput() writes to stdout
  (process.stdout as { isTTY: boolean }).isTTY = false;
  (process.stderr as { isTTY: boolean }).isTTY = false;

  try {
    const exitCode = await run();
    return { exitCode, stdout, stderr };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    (process.stdout as { isTTY: boolean }).isTTY = originalStdoutIsTTY;
    (process.stderr as { isTTY: boolean }).isTTY = originalStderrIsTTY;
  }
}
