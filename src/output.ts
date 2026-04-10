import { isAgentMessageItem, type ThreadReadResult } from "./protocol";

export interface NormalizedJsonEvent {
  type: string;
  [key: string]: unknown;
}

export interface Output {
  info(msg: string): void;
  streamDelta(delta: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  finalOutput(text: string): void;
  jsonEvent(event: NormalizedJsonEvent): void;
}

export function createOutput(json: boolean): Output {
  const writeStderr = (msg: string): void => {
    process.stderr.write(msg);
  };
  const writeStdout = (msg: string): void => {
    process.stdout.write(msg);
  };

  return {
    info(msg) {
      if (json) {
        writeStdout(JSON.stringify({ type: "info", message: msg }) + "\n");
        return;
      }
      writeStderr(`[codex-exec-remote] ${msg}\n`);
    },
    streamDelta(delta) {
      if (json) {
        writeStdout(JSON.stringify({ type: "delta", delta }) + "\n");
        return;
      }
      writeStderr(delta);
    },
    warn(msg) {
      if (json) {
        writeStdout(JSON.stringify({ type: "warning", message: msg }) + "\n");
        return;
      }
      writeStderr(`[codex-exec-remote] ⚠ ${msg}\n`);
    },
    error(msg) {
      if (json) {
        writeStdout(JSON.stringify({ type: "error", message: msg }) + "\n");
        return;
      }
      writeStderr(`[codex-exec-remote] ✗ ${msg}\n`);
    },
    finalOutput(text) {
      if (json) {
        writeStdout(JSON.stringify({ type: "finalOutput", text }) + "\n");
        return;
      }
      writeStdout(text);
      if (!text.endsWith("\n")) {
        writeStdout("\n");
      }
    },
    jsonEvent(event) {
      writeStdout(JSON.stringify(event) + "\n");
    }
  };
}

export function extractCanonicalOutput(
  readResult: ThreadReadResult,
  targetTurnId: string
): string | null {
  const targetTurn = readResult.thread.turns?.find((turn) => turn.id === targetTurnId);
  if (!targetTurn?.items) {
    return null;
  }

  const texts = targetTurn.items
    .filter(isAgentMessageItem)
    .map((item) => item.text);

  return texts.length > 0 ? texts.join("\n") : null;
}
