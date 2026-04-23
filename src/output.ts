import { isAgentMessageItem, type ThreadReadResult } from "./protocol";
import type { ThreadEvent } from "./exec-events";

export interface Output {
  info(msg: string): void;
  streamDelta(delta: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  finalOutput(text: string): void;
  jsonEvent(event: ThreadEvent): void;
  /** Clear the "operating..." progress line (tmp mode only). No-op otherwise. */
  clearOperating(): void;
}

export function createOutput(json: boolean, tmp = false): Output {
  const writeStderr = (msg: string): void => {
    process.stderr.write(msg);
  };
  const writeStdout = (msg: string): void => {
    process.stdout.write(msg);
  };

  let needsNewline = false;
  let operatingShown = false;

  const ensureNewline = (): void => {
    if (needsNewline) {
      writeStderr("\n");
      needsNewline = false;
    }
  };

  const clearOperatingLine = (): void => {
    if (operatingShown) {
      writeStderr("\r\x1b[K");
      operatingShown = false;
    }
  };

  return {
    info(msg) {
      clearOperatingLine();
      ensureNewline();
      writeStderr(`[codex-exec-remote] ${msg}\n`);
    },
    streamDelta(delta) {
      if (json) {
        return;
      }
      if (tmp) {
        if (!operatingShown) {
          writeStderr(`[codex-exec-remote] operating...\r`);
          operatingShown = true;
        }
        return;
      }
      writeStderr(delta);
      needsNewline = delta.length > 0 && !delta.endsWith("\n");
    },
    warn(msg) {
      clearOperatingLine();
      ensureNewline();
      writeStderr(`[codex-exec-remote] ⚠ ${msg}\n`);
    },
    error(msg) {
      clearOperatingLine();
      ensureNewline();
      writeStderr(`[codex-exec-remote] ✗ ${msg}\n`);
    },
    finalOutput(text) {
      if (json) {
        return;
      }
      // Match Codex original: skip stdout when both stdout and stderr are
      // terminals — the user already saw the response via streamDelta on stderr.
      // In tmp mode stdout is also skipped — output goes to file instead.
      if (tmp || (process.stdout.isTTY && process.stderr.isTTY)) {
        return;
      }
      writeStdout(text);
      if (!text.endsWith("\n")) {
        writeStdout("\n");
      }
    },
    jsonEvent(event) {
      writeStdout(JSON.stringify(event) + "\n");
    },
    clearOperating() {
      clearOperatingLine();
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
