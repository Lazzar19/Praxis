import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    env: { ...process.env, CURSOR_PROJECT_DIR: project, PRAXIS_STATE_DIR: path.join(project, ".praxis-state") },
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

  it("asks whether to turn Praxis on before any project code", () => {
    const project = tempProject();
    const started = run("session", project, { cwd: project }) as { additional_context?: string };
    const context = started.additional_context ?? "";
    assert.match(context, /AskQuestion/);
    assert.match(context, /turn Praxis on/);
    assert.match(context, /leave it off/);
    assert.match(context, /take their sentence before offering options/);
    assert.match(context, /Do not ask the student to run a command/);
    assert.equal(existsSync(path.join(project, ".praxis")), false);
    const allowed = run("gate", project, { tool_name: "Write", tool_input: { path: "src/app.ts", contents: "export const started = true;\n" }, cwd: project });
    assert.equal((allowed as { permission: string }).permission, "allow");
    const notes = run("gate", project, { tool_name: "Write", tool_input: { path: ".praxis/progress.md", contents: "Praxis: off\nStatus: off\nBypass: none\n" }, cwd: project });
    assert.equal((notes as { permission: string }).permission, "deny");
    assert.equal(existsSync(path.join(project, ".praxis")), false);
  });

  it("names a pending problem on the next session", () => {
    const project = tempProject();
    note(project, "Status: pending\nTopic: the problem\nBypass: none\n");
    const started = run("session", project, { cwd: project }) as { additional_context?: string };
    const context = started.additional_context ?? "";
    assert.match(context, /open problem: the problem/);
    assert.match(context, /Do not ask the student to run a command/);
    const denied = run("gate", project, { tool_name: "Write", tool_input: { path: "src/app.ts" }, cwd: project });
    assert.equal((denied as { permission: string }).permission, "deny");
  });

  it("stays quiet after they leave Praxis off and keeps no notes", () => {
    const project = tempProject();
    note(project, "Praxis: off\nStatus: off\nBypass: none\n");
    const started = run("session", project, { cwd: project }) as { additional_context?: string };
    assert.match(started.additional_context ?? "", /Praxis is off for this project/);
    assert.match(started.additional_context ?? "", /Do not create \.praxis/);
    assert.doesNotMatch(started.additional_context ?? "", /Their level/);
    assert.equal(existsSync(path.join(project, ".praxis")), false);
    const again = run("session", project, { cwd: project }) as { additional_context?: string };
    assert.match(again.additional_context ?? "", /Praxis is off for this project/);
    assert.equal(existsSync(path.join(project, ".praxis")), false);
    const allowed = run("gate", project, { tool_name: "Write", tool_input: { path: "src/app.ts", contents: "export const started = true;\n" }, cwd: project });
    assert.equal((allowed as { permission: string }).permission, "allow");
    const turnedOn = run("gate", project, { tool_name: "Write", tool_input: { path: ".praxis/progress.md", contents: "Praxis: on\nStatus: pending\nTopic: the floor\nBypass: none\n" }, cwd: project });
    assert.equal((turnedOn as { permission: string }).permission, "allow");
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
