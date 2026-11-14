import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-reliable-"));
  directories.push(directory);
  mkdirSync(path.join(directory, ".praxis"));
  mkdirSync(path.join(directory, "src"));
  return directory;
}

function run(command: string, project: string, input: unknown = {}): { additional_context?: string } {
  const result = spawnSync(process.execPath, [hook, command], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: project, PRAXIS_STATE_DIR: path.join(project, ".praxis-state") },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { additional_context?: string };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("session consistency and state", () => {
  it("writes schema 1 and stays quiet when the notes agree", () => {
    const project = tempProject();
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: pending\nTopic: the problem\nBypass: none\n");
    const started = run("session", project);
    assert.doesNotMatch(started.additional_context ?? "", /inconsistent session/);
    const state = JSON.parse(readFileSync(path.join(project, ".praxis", "state.json"), "utf8")) as { schemaVersion: number; topic: string };
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.topic, "the problem");
  });

  it("names a confirmed session with no decision and a marker for an unknown id", () => {
    const project = tempProject();
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: confirmed\nTopic: Where the data lives\nBypass: none\n");
    writeFileSync(path.join(project, "src", "store.ts"), "export const mark = \"TODO(praxis:storage-999)\";\n");
    const started = run("session", project);
    const context = started.additional_context ?? "";
    assert.match(context, /Praxis found an inconsistent session/);
    assert.match(context, /progress says "confirmed" and no matching decision was found/);
    assert.match(context, /unknown Decision ID storage-999/);
    assert.match(context, /Repair these notes before starting a new debate/);
  });

  it("names a damaged block, a missing marks file, a decision with no marker, and a stale export", () => {
    const project = tempProject();
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: confirmed\nTopic: Where the data lives\nDecision ID: storage-001\nBypass: none\n");
    writeFileSync(path.join(project, ".praxis", "decisions.md"), `Goal: Notes API

## Decision
Topic: Where the data lives
Decision ID: storage-001
Context: Where notes are stored.
Options: one file | a database
Choice: one file
Date: 2026-11-14
Reason:
One file is enough.
Prediction:
It writes the note.
## End

## Decision
Topic: The stack
Context: this block has no reason
## End
`);
    writeFileSync(path.join(project, ".praxis", "marks.md"), `## Mark
Topic: storage-001
File: src/missing.ts
Function: saveNote
## End
`);
    writeFileSync(path.join(project, "DECISIONS.md"), "stale\n");
    const started = run("session", project);
    const context = started.additional_context ?? "";
    assert.match(context, /a decision block is damaged and has no Reason/);
    assert.match(context, /marks.md lists src\/missing.ts, and that file is missing/);
    assert.match(context, /the decision "Where the data lives" has no marker/);
    assert.match(context, /DECISIONS.md is stale/);
    assert.match(readFileSync(path.join(project, "DECISIONS.md"), "utf8"), /One file is enough/);
  });

  it("backs up an older schema and leaves a newer schema untouched", () => {
    const project = tempProject();
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: pending\nTopic: the problem\nBypass: none\n");
    writeFileSync(path.join(project, ".praxis", "state.json"), "{\"schemaVersion\":0,\"status\":\"confirmed\",\"topic\":\"old\"}\n");
    const migrated = run("session", project);
    assert.match(migrated.additional_context ?? "", /migrated state.json to schema 1/);
    assert.equal(existsSync(path.join(project, ".praxis", "state.json.bak")), true);
    const state = JSON.parse(readFileSync(path.join(project, ".praxis", "state.json"), "utf8")) as { schemaVersion: number; topic: string };
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.topic, "the problem");

    writeFileSync(path.join(project, ".praxis", "state.json"), "{\"schemaVersion\":2,\"status\":\"pending\"}\n");
    const unknown = run("session", project);
    assert.match(unknown.additional_context ?? "", /schema 2, which this version does not read/);
    assert.equal(readFileSync(path.join(project, ".praxis", "state.json"), "utf8"), "{\"schemaVersion\":2,\"status\":\"pending\"}\n");
  });
});
