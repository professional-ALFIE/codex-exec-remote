import WebSocket from "ws";
import {
  WIRE,
  isError,
  isNotification,
  isObject,
  isResponse,
  isServerRequest,
  nextRequestId,
  type InitializeParams,
  type JsonRpcNotification,
  type JsonRpcRequest
} from "./protocol";

type PendingEntry = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type EventWaiter = {
  resolve: (value: JsonRpcNotification | JsonRpcRequest) => void;
  reject: (error: Error) => void;
};

export interface ConnectOptions {
  url: string;
  authToken?: string;
  onWarning?: (message: string) => void;
}

export class AppServerClient {
  private readonly ws: WebSocket;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly eventQueue: Array<JsonRpcNotification | JsonRpcRequest> = [];
  private eventWaiter: EventWaiter | null = null;
  private closedError: Error | null = null;
  private readonly onWarning: (message: string) => void;

  private constructor(ws: WebSocket, onWarning?: (message: string) => void) {
    this.ws = ws;
    this.onWarning = onWarning ?? (() => {});
    this.bind();
  }

  static async connect(options: ConnectOptions): Promise<AppServerClient> {
    validateRemoteAuthTransport(options.url, Boolean(options.authToken));

    const ws = await openWebSocket(options.url, options.authToken);
    const client = new AppServerClient(ws, options.onWarning);

    const initializeParams: InitializeParams = {
      clientInfo: {
        name: "codex-exec-remote",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    };

    await client.request("initialize", initializeParams);
    client.notify(WIRE.INITIALIZED);
    return client;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.assertOpen();
    const id = nextRequestId();
    if (this.pending.has(id)) {
      throw new Error(`duplicate request id: ${id}`);
    }

    return await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  notify(method: string, params?: unknown): void {
    this.assertOpen();
    const payload =
      params === undefined ? { method } : { method, params };
    this.ws.send(JSON.stringify(payload));
  }

  async nextEvent(): Promise<JsonRpcNotification | JsonRpcRequest> {
    this.assertOpen();
    const queued = this.eventQueue.shift();
    if (queued) {
      return queued;
    }

    return await new Promise<JsonRpcNotification | JsonRpcRequest>((resolve, reject) => {
      this.eventWaiter = { resolve, reject };
    });
  }

  rejectServerRequest(requestId: string, code: number, message: string): void {
    this.assertOpen();
    this.ws.send(
      JSON.stringify({
        id: requestId,
        error: { code, message }
      })
    );
  }

  close(): void {
    if (this.ws.readyState === WebSocket.CLOSING || this.ws.readyState === WebSocket.CLOSED) {
      return;
    }
    this.ws.close();
  }

  private bind(): void {
    this.ws.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString();
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        this.onWarning("received malformed JSON-RPC frame; skipping");
        return;
      }

      if (isResponse(msg)) {
        const entry = this.pending.get(msg.id);
        if (!entry) {
          this.onWarning(`received response for unknown request id: ${msg.id}`);
          return;
        }
        this.pending.delete(msg.id);
        entry.resolve(msg.result);
        return;
      }

      if (isError(msg)) {
        const entry = this.pending.get(msg.id);
        if (!entry) {
          this.onWarning(`received error for unknown request id: ${msg.id}`);
          return;
        }
        this.pending.delete(msg.id);
        entry.reject(new Error(msg.error.message));
        return;
      }

      if (isNotification(msg) || isServerRequest(msg)) {
        if (this.eventWaiter) {
          const waiter = this.eventWaiter;
          this.eventWaiter = null;
          waiter.resolve(msg);
        } else {
          this.eventQueue.push(msg);
        }
        return;
      }

      this.onWarning("received JSON frame that does not match request/response/notification/error shape; skipping");
    });

    this.ws.on("close", (_code, reason) => {
      const text = reason.toString();
      this.failAll(new Error(text ? `websocket closed: ${text}` : "websocket closed"));
    });

    this.ws.on("error", (error) => {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private failAll(error: Error): void {
    if (!this.closedError) {
      this.closedError = error;
    }
    for (const [, entry] of this.pending) {
      entry.reject(this.closedError);
    }
    this.pending.clear();
    if (this.eventWaiter) {
      this.eventWaiter.reject(this.closedError);
      this.eventWaiter = null;
    }
  }

  private assertOpen(): void {
    if (this.closedError) {
      throw this.closedError;
    }
  }
}

async function openWebSocket(url: string, authToken?: string): Promise<WebSocket> {
  return await new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
    });

    const cleanup = (): void => {
      ws.off("open", onOpen);
      ws.off("error", onError);
    };

    const onOpen = (): void => {
      cleanup();
      resolve(ws);
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    ws.once("open", onOpen);
    ws.once("error", onError);
  });
}

function validateRemoteAuthTransport(url: string, hasAuthToken: boolean): void {
  if (!hasAuthToken) {
    return;
  }
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  const isLoopback =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const isAllowed = parsed.protocol === "wss:" || (parsed.protocol === "ws:" && isLoopback);
  if (!isAllowed) {
    throw new Error(
      `remote auth tokens require \`wss://\` or loopback \`ws://\` URLs; got \`${url}\``
    );
  }
}

export function queueLengthForTest(client: AppServerClient): number {
  return (client as unknown as { eventQueue: unknown[] }).eventQueue.length;
}
