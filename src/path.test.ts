import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-path-"));
  directories.push(directory);
  mkdirSync(path.join(directory, ".praxis"));
  mkdirSync(path.join(directory, "src"));
  return directory;
}

function run(command: string, project: string): void {
  const result = spawnSync(process.execPath, [hook, command], {
    input: "{}",
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: project },
  });
  assert.equal(result.status, 0, result.stderr);
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("student path", () => {
  it("finishes a session without the card and without the core YAML tree", () => {
    const pluginMcp = JSON.parse(readFileSync(new URL("../mcp.json", import.meta.url), "utf8")) as { mcpServers: Record<string, unknown> };
    const workspaceMcp = JSON.parse(readFileSync(new URL("../.cursor/mcp.json", import.meta.url), "utf8")) as { mcpServers: Record<string, unknown> };
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { contributes?: { commands?: unknown[] } };
    const extension = readFileSync(new URL("./extension/extension.ts", import.meta.url), "utf8");
    const hookSource = readFileSync(new URL("../hooks/praxis.mjs", import.meta.url), "utf8");
    assert.deepEqual(pluginMcp.mcpServers, {});
    assert.deepEqual(workspaceMcp.mcpServers, {});
    assert.equal(pkg.contributes, undefined);
    assert.doesNotMatch(extension, /showQuestion/);
    assert.doesNotMatch(hookSource, /core\.yaml|scaffold_todos|showQuestion/);

    const project = tempProject();
    const reason = "Only I run it this week.";
    const prediction = "The server listens on one port.";
    writeFileSync(path.join(project, ".praxis", "decisions.md"), `Goal: Notes API

## Decision
Topic: How it ships
Context: How a classmate reaches it.
Options: one port | a managed host
Choice: one port
Date: 2026-11-09
Reason:
${reason}
Prediction:
${prediction}
## End
`);
    writeFileSync(path.join(project, "src", "serve.ts"), `export function serveNotes(): void {
  throw new Error("TODO(praxis:How it ships)");
}
`);
    run("stop", project);
    writeFileSync(path.join(project, "src", "serve.ts"), `export function serveNotes(): void {
  listen(3000);
}
`);
    writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: How it ships
Matched: yes
## End
`);
    run("stop", project);

    const decisions = readFileSync(path.join(project, "DECISIONS.md"), "utf8");
    const report = readFileSync(path.join(project, ".praxis", "report.md"), "utf8");
    assert.ok(decisions.includes(reason));
    assert.ok(report.includes(reason));
    assert.ok(report.includes(prediction));
    assert.match(report, /Matched: yes/);
    assert.equal(existsSync(path.join(project, ".praxis", "session.json")), false);
    assert.equal(existsSync(path.join(project, "questions", "core.yaml")), false);
  });

  it("runs the plugin stop hook from the student folder", () => {
    const hooks = JSON.parse(readFileSync(new URL("../hooks/hooks.json", import.meta.url), "utf8")) as {
      hooks: { stop: { command: string }[] };
    };
    const projectHooks = JSON.parse(readFileSync(new URL("../.cursor/hooks.json", import.meta.url), "utf8")) as {
      hooks: { stop: { command: string }[] };
    };
    const command = hooks.hooks.stop[0]?.command ?? "";
    assert.match(command, /CURSOR_PLUGIN_ROOT/);
    assert.equal(projectHooks.hooks.stop[0]?.command, "node hooks/praxis.mjs stop");

    const project = tempProject();
    writeFileSync(path.join(project, ".praxis", "decisions.md"), `Goal: Notes API

## Decision
Topic: How it ships
Context: How a classmate reaches it.
Options: one port | a managed host
Choice: one port
Date: 2026-11-10
Reason:
Only I run it this week.
## End
`);
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: pending\nTopic: How it ships\nBypass: one-step\n");
    const result = spawnSync("bash", ["-lc", command], {
      cwd: project,
      input: "{}",
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_PROJECT_DIR: project,
        CURSOR_PLUGIN_ROOT: fileURLToPath(new URL("..", import.meta.url)),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {});
    assert.match(readFileSync(path.join(project, "DECISIONS.md"), "utf8"), /Only I run it this week\./);
    assert.match(readFileSync(path.join(project, ".praxis", "progress.md"), "utf8"), /Bypass: none/);
  });
});
