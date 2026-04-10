import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { AppServerClient } from "../src/client";
import { WIRE, resetRequestIds } from "../src/protocol";
import { extractCanonicalOutput } from "../src/output";

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

describe("client", () => {
  test("connect performs initialize handshake and forwards auth header", async () => {
    let authHeader: string | undefined;
    server = createServer();
    const wss = new WebSocketServer({ noServer: true });

    wss.on("connection", (socket) => {
      let step = 0;
      socket.on("message", (data) => {
        const msg = JSON.parse(String(data));
        if (step === 0) {
          expect(msg.method).toBe("initialize");
          socket.send(JSON.stringify({ id: msg.id, result: { ok: true } }));
          step += 1;
          return;
        }

        expect(msg.method).toBe(WIRE.INITIALIZED);
      });
    });

    server.on("upgrade", (req, socket, head) => {
      authHeader = req.headers.authorization;
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });

    await listen(server);
    const url = addressToWs(server);

    const client = await AppServerClient.connect({
      url,
      authToken: "secret-token"
    });

    expect(authHeader).toBe("Bearer secret-token");
    client.close();
  });

  test("queues early notification before initialize response", async () => {
    resetRequestIds();
    server = createServer();
    const wss = new WebSocketServer({ noServer: true });

    wss.on("connection", (socket) => {
      socket.once("message", (data) => {
        const msg = JSON.parse(String(data));
        socket.send(JSON.stringify({ method: WIRE.PLAN_DELTA, params: { threadId: "thr", turnId: "turn", itemId: "item", delta: "x" } }));
        socket.send(JSON.stringify({ id: msg.id, result: { ok: true } }));
      });

      socket.once("message", () => {
        // initialized
      });
    });

    server.on("upgrade", (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });

    await listen(server);
    const client = await AppServerClient.connect({ url: addressToWs(server) });
    const event = await client.nextEvent();
    expect("method" in event && event.method).toBe(WIRE.PLAN_DELTA);
    client.close();
  });

  test("malformed frame is skipped and later event is still delivered", async () => {
    const warnings: string[] = [];
    server = createServer();
    const wss = new WebSocketServer({ noServer: true });

    wss.on("connection", (socket) => {
      socket.once("message", (data) => {
        const init = JSON.parse(String(data));
        socket.send(JSON.stringify({ id: init.id, result: { ok: true } }));
      });
      socket.once("message", () => {
        socket.send("{bad json");
        socket.send(JSON.stringify({ method: WIRE.ITEM_COMPLETED, params: { threadId: "thr", turnId: "turn", item: { type: "agentMessage", text: "done" } } }));
      });
    });

    server.on("upgrade", (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });

    await listen(server);
    const client = await AppServerClient.connect({
      url: addressToWs(server),
      onWarning: (msg) => warnings.push(msg)
    });
    const event = await client.nextEvent();
    expect(event.method).toBe(WIRE.ITEM_COMPLETED);
    expect(warnings.some((msg) => msg.includes("malformed JSON-RPC frame"))).toBe(true);
    client.close();
  });

  test("orphan response is skipped", async () => {
    const warnings: string[] = [];
    server = createServer();
    const wss = new WebSocketServer({ noServer: true });

    wss.on("connection", (socket) => {
      socket.once("message", (data) => {
        const init = JSON.parse(String(data));
        socket.send(JSON.stringify({ id: init.id, result: { ok: true } }));
      });
      socket.once("message", () => {
        socket.send(JSON.stringify({ id: "999", result: { stray: true } }));
        socket.send(JSON.stringify({ method: WIRE.TURN_COMPLETED, params: { threadId: "thr", turn: { id: "turn", status: "completed" } } }));
      });
    });

    server.on("upgrade", (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });

    await listen(server);
    const client = await AppServerClient.connect({
      url: addressToWs(server),
      onWarning: (msg) => warnings.push(msg)
    });
    const event = await client.nextEvent();
    expect(event.method).toBe(WIRE.TURN_COMPLETED);
    expect(warnings.some((msg) => msg.includes("unknown request id"))).toBe(true);
    client.close();
  });

  test("extractCanonicalOutput returns assistant text from thread/read result", () => {
    const value = extractCanonicalOutput(
      {
        thread: {
          id: "thr",
          turns: [
            {
              id: "turn-1",
              items: [
                { type: "plan", text: "skip" },
                { type: "agentMessage", text: "hello" },
                { type: "agentMessage", text: "world" }
              ]
            }
          ]
        }
      },
      "turn-1"
    );
    expect(value).toBe("hello\nworld");
  });
});

function listen(httpServer: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
    httpServer.once("error", reject);
  });
}

function addressToWs(httpServer: HttpServer): string {
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("server address unavailable");
  }
  return `ws://127.0.0.1:${address.port}`;
}
