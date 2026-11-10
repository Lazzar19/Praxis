import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { clearOneStep, gateEdit, parseProgress, sessionContext } from "../hooks/praxis.mjs";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-gate-"));
  directories.push(directory);
  mkdirSync(path.join(directory, ".praxis"));
  return directory;
}

function note(project: string, body: string): void {
  writeFileSync(path.join(project, ".praxis", "progress.md"), body);
}

function run(command: string, project: string, input: unknown): unknown {
  const result = spawnSync(process.execPath, [hook, command], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: project },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("edit gate", () => {
  const pending = "Status: pending\nTopic: where the data lives\nBypass: none\n";

  it("denies a file edit while a decision is open and allows notes", () => {
    const progress = parseProgress(pending);
    const denied = gateEdit(progress, "src/app.ts", "/student");
    assert.equal(denied.permission, "deny");
    assert.match(denied.agent_message ?? "", /where the data lives/);
    assert.equal(gateEdit(progress, ".praxis/progress.md", "/student").permission, "allow");
  });

  it("allows a confirmed step and one bypass step", () => {
    const root = "/student";
    assert.equal(gateEdit(parseProgress("Status: confirmed\nTopic: stack\nBypass: none\n"), "src/app.ts", root).permission, "allow");
    assert.equal(gateEdit(parseProgress("Status: pending\nTopic: stack\nBypass: one-step\n"), "src/app.ts", root).permission, "allow");
    assert.equal(gateEdit(parseProgress(""), "src/app.ts", root).permission, "allow");
  });

  it("tells a new session about the open decision without a command", () => {
    const project = tempProject();
    note(project, pending);
    const context = sessionContext(parseProgress(pending));
    assert.match(context, /where the data lives/);
    assert.match(context, /Do not ask the student to run a command/);
    const started = run("session", project, { cwd: project });
    assert.deepEqual(started, { additional_context: context });
  });

  it("asks every floor topic in the first reply of a new student chat", () => {
    const project = tempProject();
    const started = run("session", project, { cwd: project }) as { additional_context?: string };
    const context = started.additional_context ?? "";
    for (const topic of ["Their level", "The stack", "Where the data lives", "Who may see or change it", "How it ships"]) {
      assert.ok(context.includes(topic), topic);
    }
    assert.match(context, /AskQuestion/);
    assert.match(context, /one question/);
    assert.match(context, /before any project code/);
    assert.match(context, /no fixed list of answers/);
    assert.match(context, /Do not ask the student to run a command/);
    assert.match(readFileSync(path.join(project, ".praxis", "progress.md"), "utf8"), /Status: pending/);
    const denied = run("gate", project, { tool_name: "Write", tool_input: { path: "src/app.ts", contents: "export const started = true;\n" }, cwd: project });
    assert.equal((denied as { permission: string }).permission, "deny");
  });

  it("denies through the hook, then allows one step and closes the bypass", () => {
    const project = tempProject();
    note(project, pending);
    const denied = run("gate", project, { tool_name: "Write", tool_input: { path: "src/app.ts" }, cwd: project });
    assert.equal((denied as { permission: string }).permission, "deny");

    note(project, "Status: pending\nTopic: where the data lives\nBypass: one-step\n");
    const allowed = run("gate", project, { tool_name: "StrReplace", tool_input: { path: "src/app.ts" }, cwd: project });
    assert.equal((allowed as { permission: string }).permission, "allow");
    run("stop", project, {});
    assert.match(readFileSync(path.join(project, ".praxis", "progress.md"), "utf8"), /Bypass: none/);
    assert.equal(clearOneStep("Bypass: one-step\n"), "Bypass: none\n");

    const again = run("gate", project, { tool_name: "Write", tool_input: { path: "src/app.ts" }, cwd: project });
    assert.equal((again as { permission: string }).permission, "deny");
  });
});
