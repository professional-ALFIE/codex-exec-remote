import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/index";

describe("index cli parsing", () => {
  test("no args means serve mode with default listen", () => {
    expect(parseArgs([])).toEqual({
      command: "serve",
      listen: "ws://127.0.0.1:4501",
      codexBin: "codex"
    });
  });

  test("--listen means serve mode with custom listen", () => {
    expect(parseArgs(["--listen", "ws://127.0.0.1:9999"])).toEqual({
      command: "serve",
      listen: "ws://127.0.0.1:9999",
      codexBin: "codex"
    });
  });

  test("resume uses --remote option", () => {
    expect(
      parseArgs(["resume", "thread-1", "hello world", "--remote", "ws://127.0.0.1:7777"])
    ).toEqual({
      command: "resume",
      threadId: "thread-1",
      prompt: "hello world",
      remote: "ws://127.0.0.1:7777",
      authTokenEnv: undefined,
      json: false,
      timeoutSec: 300,
      codexBin: "codex"
    });
  });
});
