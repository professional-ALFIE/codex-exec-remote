import { describe, expect, test } from "bun:test";
import { normalizeCompiledCliArgv, parseArgs } from "../src/index";

describe("index cli parsing", () => {
  test("no args means serve mode with default listen", () => {
    expect(parseArgs([])).toEqual({
      command: "serve",
      listen: "ws://127.0.0.1:4501",
      codexBin: "codex"
    });
  });

  test("serve uses default listen", () => {
    expect(parseArgs(["serve"])).toEqual({
      command: "serve",
      listen: "ws://127.0.0.1:4501",
      codexBin: "codex"
    });
  });

  test("serve accepts custom listen", () => {
    expect(parseArgs(["serve", "--listen", "ws://127.0.0.1:9999"])).toEqual({
      command: "serve",
      listen: "ws://127.0.0.1:9999",
      codexBin: "codex"
    });
  });

  test("start subcommand means start new thread", () => {
    expect(parseArgs(["start", "hello", "world"])).toEqual({
      command: "start",
      prompt: "hello world",
      remote: "ws://127.0.0.1:4501",
      authTokenEnv: undefined,
      json: false,
      timeoutSec: 300,
      codexBin: "codex"
    });
  });

  test("resume uses --remote option", () => {
    expect(
      parseArgs(["resume", "thread-1", "hello world", "--remote", "ws://127.0.0.1:7777"])
    ).toEqual({
      command: "resume",
      last: false,
      threadId: "thread-1",
      prompt: "hello world",
      remote: "ws://127.0.0.1:7777",
      authTokenEnv: undefined,
      json: false,
      timeoutSec: 300,
      codexBin: "codex"
    });
  });

  test("resume --last treats positional as prompt", () => {
    expect(parseArgs(["resume", "--last", "hello world"])).toEqual({
      command: "resume",
      last: true,
      threadId: undefined,
      prompt: "hello world",
      remote: "ws://127.0.0.1:4501",
      authTokenEnv: undefined,
      json: false,
      timeoutSec: 300,
      codexBin: "codex"
    });
  });

  test("compiled no-arg execution strips self executable name", () => {
    expect(
      normalizeCompiledCliArgv(["bun", "/$bunfs/root/codex-exec-remote", "cer"])
    ).toEqual([]);

    expect(
      normalizeCompiledCliArgv([
        "bun",
        "/$bunfs/root/codex-exec-remote",
        "/Users/noseung-gyeong/bin/codex-exec-remote"
      ])
    ).toEqual([]);
  });

  test("compiled argv keeps real user arguments", () => {
    expect(
      normalizeCompiledCliArgv(["bun", "/$bunfs/root/codex-exec-remote", "start", "hello"])
    ).toEqual(["start", "hello"]);

    expect(
      normalizeCompiledCliArgv(["bun", "/$bunfs/root/codex-exec-remote", "--listen"])
    ).toEqual(["--listen"]);
  });
});
