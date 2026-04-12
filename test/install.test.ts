import { afterEach, describe, expect, test } from "bun:test";
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = process.cwd();
const SNAPSHOT_FILES = ["package.json", "bun.lock", "tsconfig.json"] as const;
const cleanupTargets: string[] = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    if (!target) {
      continue;
    }

    await rm(target, { recursive: true, force: true });
  }
});

describe("installer", () => {
  test("install.sh installs managed launchers that work in a clean bash shell", async () => {
    const fixtureRepo = await createFixtureRepoSnapshot();
    const homeDir = await createTempDir("codex-exec-remote-home-");
    const installRoot = join(homeDir, ".codex-exec-remote");
    const codexBinDir = join(homeDir, "codex-bin");
    const cleanPath = `${join(homeDir, "bin")}:/bin:/usr/bin`;
    const codexLogPath = join(homeDir, "codex.log");

    await mkdir(codexBinDir, { recursive: true });
    await writeCodexStub(join(codexBinDir, "codex"), codexLogPath);

    const installResult = await runCommand(
      ["/bin/bash", join(PROJECT_ROOT, "install.sh")],
      {
        cwd: PROJECT_ROOT,
        env: buildEnv({
          HOME: homeDir,
          SHELL: "/bin/bash",
          PATH: `${codexBinDir}:${process.env.PATH ?? ""}`,
          CODEX_STUB_LOG: codexLogPath,
          CODEX_EXEC_REMOTE_HOME: installRoot,
          CODEX_EXEC_REMOTE_REPO_URL: fixtureRepo,
          CODEX_EXEC_REMOTE_CLEAN_PATH: cleanPath
        })
      }
    );

    expect(installResult.exitCode).toBe(0);
    expect(installResult.stdout).toContain("Installed codex-exec-remote");

    const helpResult = await runCleanShell(homeDir, cleanPath, codexLogPath, [
      "command -v cer >/dev/null",
      "cer --help >/dev/null",
      "command -v codex-exec-remote >/dev/null",
      "codex-exec-remote --help >/dev/null"
    ]);
    expect(helpResult.exitCode).toBe(0);

    const serveResult = await runCleanShell(homeDir, cleanPath, codexLogPath, [
      "cer --listen ws://127.0.0.1:7777 >/dev/null"
    ]);
    expect(serveResult.exitCode).toBe(0);

    const codexCalls = (await readFile(codexLogPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);

    expect(codexCalls).toContainEqual(["app-server", "--help"]);
    expect(codexCalls).toContainEqual([
      "--dangerously-bypass-approvals-and-sandbox",
      "app-server",
      "--listen",
      "ws://127.0.0.1:7777"
    ]);
  });

  test("install.sh chooses the first writable directory from clean PATH order", async () => {
    const fixtureRepo = await createFixtureRepoSnapshot();
    const homeDir = await createTempDir("codex-exec-remote-home-");
    const installRoot = join(homeDir, ".codex-exec-remote");
    const preferredBinDir = join(homeDir, "npm-bin");
    const fallbackBinDir = join(homeDir, "bin");
    const codexBinDir = join(homeDir, "codex-bin");
    const cleanPath = `${preferredBinDir}:${fallbackBinDir}:/bin:/usr/bin`;
    const codexLogPath = join(homeDir, "codex.log");

    await mkdir(preferredBinDir, { recursive: true });
    await mkdir(fallbackBinDir, { recursive: true });
    await mkdir(codexBinDir, { recursive: true });
    await writeCodexStub(join(codexBinDir, "codex"), codexLogPath);

    const installResult = await runCommand(
      ["/bin/bash", join(PROJECT_ROOT, "install.sh")],
      {
        cwd: PROJECT_ROOT,
        env: buildEnv({
          HOME: homeDir,
          SHELL: "/bin/bash",
          PATH: `${codexBinDir}:${process.env.PATH ?? ""}`,
          CODEX_STUB_LOG: codexLogPath,
          CODEX_EXEC_REMOTE_HOME: installRoot,
          CODEX_EXEC_REMOTE_REPO_URL: fixtureRepo,
          CODEX_EXEC_REMOTE_CLEAN_PATH: cleanPath
        })
      }
    );

    expect(installResult.exitCode).toBe(0);
    expect(installResult.stdout).toContain(`launcher: ${preferredBinDir}/codex-exec-remote`);
    expect(await pathExists(join(preferredBinDir, "codex-exec-remote"))).toBe(true);
    expect(await pathExists(join(preferredBinDir, "cer"))).toBe(true);
    expect(await pathExists(join(fallbackBinDir, "codex-exec-remote"))).toBe(false);

    const helpResult = await runCleanShell(homeDir, cleanPath, codexLogPath, [
      "command -v cer >/dev/null",
      "cer --help >/dev/null"
    ]);
    expect(helpResult.exitCode).toBe(0);
  });

  test("install.sh skips relative clean PATH entries before choosing an absolute writable directory", async () => {
    const fixtureRepo = await createFixtureRepoSnapshot();
    const homeDir = await createTempDir("codex-exec-remote-home-");
    const launcherWorkDir = await createTempDir("codex-exec-remote-cwd-");
    const installRoot = join(homeDir, ".codex-exec-remote");
    const preferredBinDir = join(homeDir, "npm-bin");
    const codexBinDir = join(homeDir, "codex-bin");
    const relativeBinDir = join(launcherWorkDir, "bin");
    const cleanPath = `./bin:bin:${preferredBinDir}:/bin:/usr/bin`;
    const codexLogPath = join(homeDir, "codex.log");

    await mkdir(relativeBinDir, { recursive: true });
    await mkdir(preferredBinDir, { recursive: true });
    await mkdir(codexBinDir, { recursive: true });
    await writeCodexStub(join(codexBinDir, "codex"), codexLogPath);

    const installResult = await runCommand(
      ["/bin/bash", join(PROJECT_ROOT, "install.sh")],
      {
        cwd: launcherWorkDir,
        env: buildEnv({
          HOME: homeDir,
          SHELL: "/bin/bash",
          PATH: `${codexBinDir}:${process.env.PATH ?? ""}`,
          CODEX_STUB_LOG: codexLogPath,
          CODEX_EXEC_REMOTE_HOME: installRoot,
          CODEX_EXEC_REMOTE_REPO_URL: fixtureRepo,
          CODEX_EXEC_REMOTE_CLEAN_PATH: cleanPath
        })
      }
    );

    expect(installResult.exitCode).toBe(0);
    expect(installResult.stdout).toContain(`launcher: ${preferredBinDir}/codex-exec-remote`);
    expect(await pathExists(join(relativeBinDir, "codex-exec-remote"))).toBe(false);
    expect(await pathExists(join(relativeBinDir, "cer"))).toBe(false);
    expect(await pathExists(join(preferredBinDir, "codex-exec-remote"))).toBe(true);
    expect(await pathExists(join(preferredBinDir, "cer"))).toBe(true);

    const helpResult = await runCleanShell(homeDir, cleanPath, codexLogPath, [
      "command -v cer >/dev/null",
      "cer --help >/dev/null"
    ]);
    expect(helpResult.exitCode).toBe(0);
  });

  test("install.sh fails when clean PATH has only relative entries before non-writable absolute directories", async () => {
    const homeDir = await createTempDir("codex-exec-remote-home-");
    const launcherWorkDir = await createTempDir("codex-exec-remote-cwd-");
    const relativeBinDir = join(launcherWorkDir, "bin");
    const codexBinDir = join(homeDir, "codex-bin");
    const cleanPath = `./bin:bin:/bin:/usr/bin`;
    const codexLogPath = join(homeDir, "codex.log");

    await mkdir(relativeBinDir, { recursive: true });
    await mkdir(codexBinDir, { recursive: true });
    await writeCodexStub(join(codexBinDir, "codex"), codexLogPath);

    const installResult = await runCommand(
      ["/bin/bash", join(PROJECT_ROOT, "install.sh")],
      {
        cwd: launcherWorkDir,
        env: buildEnv({
          HOME: homeDir,
          SHELL: "/bin/bash",
          PATH: `${codexBinDir}:${process.env.PATH ?? ""}`,
          CODEX_STUB_LOG: codexLogPath,
          CODEX_EXEC_REMOTE_CLEAN_PATH: cleanPath
        })
      }
    );

    expect(installResult.exitCode).not.toBe(0);
    expect(installResult.stderr).toContain(
      "No writable install directory was found on the default noninteractive PATH."
    );
    expect(installResult.stderr).toContain(`clean PATH: ${cleanPath}`);
    expect(await pathExists(join(relativeBinDir, "codex-exec-remote"))).toBe(false);
    expect(await pathExists(join(relativeBinDir, "cer"))).toBe(false);
  });

  test("explicit custom bin dir falls back to profile updates when clean PATH cannot see it", async () => {
    const fixtureRepo = await createFixtureRepoSnapshot();
    const homeDir = await createTempDir("codex-exec-remote-home-");
    const installRoot = join(homeDir, ".codex-exec-remote");
    const customBinDir = join(homeDir, "custom-bin");
    const codexBinDir = join(homeDir, "codex-bin");
    const cleanPath = `${join(homeDir, "bin")}:/bin:/usr/bin`;
    const codexLogPath = join(homeDir, "codex.log");

    await mkdir(codexBinDir, { recursive: true });
    await writeCodexStub(join(codexBinDir, "codex"), codexLogPath);

    const installResult = await runCommand(
      ["/bin/bash", join(PROJECT_ROOT, "install.sh")],
      {
        cwd: PROJECT_ROOT,
        env: buildEnv({
          HOME: homeDir,
          SHELL: "/bin/bash",
          PATH: `${codexBinDir}:${process.env.PATH ?? ""}`,
          CODEX_STUB_LOG: codexLogPath,
          CODEX_EXEC_REMOTE_HOME: installRoot,
          CODEX_EXEC_REMOTE_REPO_URL: fixtureRepo,
          CODEX_EXEC_REMOTE_BIN_DIR: customBinDir,
          CODEX_EXEC_REMOTE_CLEAN_PATH: cleanPath
        })
      }
    );

    expect(installResult.exitCode).toBe(0);
    expect(installResult.stdout).toContain("interactive shells after profile reload");

    const profileText = await readFile(join(homeDir, ".profile"), "utf8");
    expect(profileText).toContain(`export PATH="${customBinDir}:$PATH"`);

    const directServeResult = await runCommand(
      [join(customBinDir, "cer"), "--listen", "ws://127.0.0.1:8899"],
      {
        cwd: PROJECT_ROOT,
        env: buildEnv({
          HOME: homeDir,
          CODEX_STUB_LOG: codexLogPath
        })
      }
    );

    expect(directServeResult.exitCode).toBe(0);
  });
});

async function createFixtureRepoSnapshot(): Promise<string> {
  const repoDir = await createTempDir("codex-exec-remote-repo-");

  for (const file of SNAPSHOT_FILES) {
    await cp(join(PROJECT_ROOT, file), join(repoDir, file));
  }
  await cp(join(PROJECT_ROOT, "src"), join(repoDir, "src"), { recursive: true });

  await runCommandOrThrow(["git", "init", "-b", "master"], { cwd: repoDir });
  await runCommandOrThrow(["git", "config", "user.name", "Codex Installer Test"], { cwd: repoDir });
  await runCommandOrThrow(["git", "config", "user.email", "codex@example.com"], { cwd: repoDir });
  await runCommandOrThrow(["git", "add", "."], { cwd: repoDir });
  await runCommandOrThrow(["git", "commit", "-m", "fixture"], { cwd: repoDir });

  return repoDir;
}

async function writeCodexStub(stubPath: string, logPath: string): Promise<void> {
  const escapedLogPath = JSON.stringify(logPath);
  const source = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");

const args = process.argv.slice(2);
appendFileSync(process.env.CODEX_STUB_LOG || ${escapedLogPath}, JSON.stringify(args) + "\\n");
process.exit(0);
`;

  await writeFile(stubPath, source, "utf8");
  await chmod(stubPath, 0o755);
  await writeFile(logPath, "", "utf8");
}

async function runCleanShell(
  homeDir: string,
  cleanPath: string,
  codexLogPath: string,
  commands: string[]
): Promise<CommandResult> {
  const script = `PATH='${cleanPath}'; ${commands.join(" && ")}`;
  return await runCommand(
    ["/usr/bin/env", "-i", `HOME=${homeDir}`, `CODEX_STUB_LOG=${codexLogPath}`, "/bin/bash", "-c", script],
    {
      cwd: PROJECT_ROOT
    }
  );
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanupTargets.push(dir);
  return dir;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function buildEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
      continue;
    }

    env[key] = value;
  }

  return env;
}

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function runCommand(
  cmd: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
  } = {}
): Promise<CommandResult> {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe"
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ]);

  return { exitCode, stdout, stderr };
}

async function runCommandOrThrow(
  cmd: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
  } = {}
): Promise<CommandResult> {
  const result = await runCommand(cmd, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `command failed (${cmd.join(" ")}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  return result;
}
