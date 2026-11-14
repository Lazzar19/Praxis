import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-matrix-"));
  directories.push(directory);
  mkdirSync(path.join(directory, ".praxis"));
  mkdirSync(path.join(directory, "src"));
  return directory;
}

function note(project: string, body: string): void {
  writeFileSync(path.join(project, ".praxis", "progress.md"), body);
}

function gate(project: string, input: unknown): { permission: string } {
  const result = spawnSync(process.execPath, [hook, "gate"], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: project, PRAXIS_STATE_DIR: path.join(project, ".praxis-state") },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { permission: string };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("hook edit matrix", () => {
  it("follows the pending, bypass, confirmed, and marker rows", () => {
    const project = tempProject();
    note(project, "Status: pending\nTopic: where the data lives\nBypass: none\n");
    assert.equal(gate(project, { tool_name: "Write", tool_input: { path: "src/app.ts", contents: "export const started = true;\n" } }).permission, "deny");
    assert.equal(gate(project, { tool_name: "Write", tool_input: { path: ".praxis/map.md", contents: "# Map\n" } }).permission, "allow");

    note(project, "Status: pending\nTopic: where the data lives\nBypass: one-step\n");
    assert.equal(gate(project, { tool_name: "Write", tool_input: { path: "src/app.ts", contents: "export const started = true;\n" } }).permission, "allow");

    note(project, "Status: confirmed\nTopic: where the data lives\nBypass: none\n");
    writeFileSync(path.join(project, "src", "store.ts"), "export const mark = \"TODO(praxis:Where the data lives)\";\n");
    assert.equal(gate(project, { tool_name: "Write", tool_input: { path: "src/plain.ts", contents: "export const plain = true;\n" } }).permission, "allow");
    assert.equal(gate(project, {
      tool_name: "StrReplace",
      tool_input: { path: "src/store.ts", old_string: "export const mark", new_string: "export const mark" },
    }).permission, "allow");
    assert.equal(gate(project, {
      tool_name: "StrReplace",
      tool_input: { path: "src/store.ts", old_string: "TODO(praxis:Where the data lives)", new_string: "done" },
    }).permission, "deny");
  });

  it("covers paths, missing input, new files, delete, and marker shapes", () => {
    const project = tempProject();
    note(project, "Status: pending\nTopic: where the data lives\nBypass: none\n");
    assert.equal(gate(project, { tool_name: "Write", tool_input: { path: "src\\app.ts", contents: "export const started = true;\n" } }).permission, "deny");
    assert.equal(gate(project, { tool_name: "Write", tool_input: { path: path.join(project, "src", "app.ts"), contents: "export const started = true;\n" } }).permission, "deny");
    assert.equal(gate(project, { tool_name: "Write" }).permission, "deny");
    assert.equal(gate(project, { tool_name: "StrReplace", tool_input: { path: "src/missing.ts", old_string: "a", new_string: "b" } }).permission, "deny");
    assert.equal(gate(project, { tool_name: "Write", tool_input: { path: "src/new.ts", contents: "export const created = true;\n" } }).permission, "deny");

    note(project, "Status: confirmed\nTopic: where the data lives\nBypass: none\n");
    assert.equal(gate(project, { tool_name: "Write", tool_input: { path: "src/new.ts", contents: "export const created = true;\n" } }).permission, "allow");
    assert.equal(gate(project, { tool_name: "Write", tool_input: { path: "src/Store.ts", contents: "export const other = true;\n" } }).permission, "allow");
    writeFileSync(path.join(project, "src", "store.ts"), `export function saveNote(): string {
  // TODO(praxis:Where the data lives)
  return "";
}
`);
    assert.equal(gate(project, {
      tool_name: "StrReplace",
      tool_input: { path: "src/store.ts", old_string: "return \"\";", new_string: "return \"notes\";" },
    }).permission, "allow");
    assert.equal(gate(project, { tool_name: "Delete", tool_input: { path: "src/store.ts" } }).permission, "deny");
    assert.equal(gate(project, { tool_name: "Delete", tool_input: { path: "src/Store.ts" } }).permission, "allow");

    writeFileSync(path.join(project, "src", "quoted.ts"), "export const mark = \"TODO(praxis:where's-data)\";\n");
    assert.equal(gate(project, {
      tool_name: "StrReplace",
      tool_input: { path: "src/quoted.ts", old_string: "TODO(praxis:where's-data)", new_string: "done" },
    }).permission, "deny");
    writeFileSync(path.join(project, "src", "both.ts"), `export function saveNote(): string {
  throw new Error("TODO(praxis:Where the data lives)");
}
export function listNotes(): string {
  throw new Error("TODO(praxis:Where the data lives)");
}
`);
    assert.equal(gate(project, {
      tool_name: "StrReplace",
      tool_input: {
        path: "src/both.ts",
        old_string: "export function listNotes(): string {\n  throw new Error(\"TODO(praxis:Where the data lives)\");\n}",
        new_string: "export function listNotes(): string {\n  return \"\";\n}",
      },
    }).permission, "deny");
  });
});
