import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { parseDecisions } from "../hooks/record.mjs";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");
const prediction = "It writes notes to {{goal}}.";
const reason = "  One file is enough.  ";

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-review-"));
  directories.push(directory);
  mkdirSync(path.join(directory, ".praxis"));
  mkdirSync(path.join(directory, "src"));
  return directory;
}

function run(command: string, project: string, input: unknown = {}): unknown {
  const result = spawnSync(process.execPath, [hook, command], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: project },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function writeDecision(project: string): void {
  writeFileSync(path.join(project, ".praxis", "decisions.md"), `Goal: Notes API

## Decision
Topic: Where the data lives
Context: Where notes are stored.
Options: one file | a database
Choice: one file
Date: 2026-11-09
Reason:
${reason}
Prediction:
${prediction}
## End
`);
  writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: confirmed\nTopic: Where the data lives\nBypass: none\n");
}

function writeStub(project: string): void {
  writeFileSync(path.join(project, "src", "store.ts"), `export function saveNote(): string {
  throw new Error("TODO(praxis:Where the data lives)");
}
`);
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("prediction and review", () => {
  it("stores the prediction unchanged and keeps the marked function", () => {
    const project = tempProject();
    writeDecision(project);
    writeStub(project);
    run("stop", project);
    const decisions = readFileSync(path.join(project, "DECISIONS.md"), "utf8");
    assert.ok(decisions.includes(reason));
    assert.ok(decisions.includes(prediction));
    assert.equal(parseDecisions(readFileSync(path.join(project, ".praxis", "decisions.md"), "utf8")).decisions[0]?.prediction, prediction);
    assert.match(readFileSync(path.join(project, ".praxis", "marks.md"), "utf8"), /Function: saveNote/);

    const denied = run("gate", project, {
      tool_name: "StrReplace",
      tool_input: {
        path: "src/store.ts",
        old_string: 'throw new Error("TODO(praxis:Where the data lives)");',
        new_string: 'return "notes";',
      },
    }) as { permission: string; agent_message?: string };
    assert.equal(denied.permission, "deny");
    assert.match(denied.agent_message ?? "", /Do not remove TODO\(praxis:Where the data lives\)/);
    assert.match(readFileSync(path.join(project, "src", "store.ts"), "utf8"), /TODO\(praxis:Where the data lives\)/);

    const allowed = run("gate", project, {
      tool_name: "StrReplace",
      tool_input: {
        path: "src/store.ts",
        old_string: "export function saveNote(): string {",
        new_string: "export function saveNote(): string {",
      },
    }) as { permission: string };
    assert.equal(allowed.permission, "allow");
  });

  it("reviews a filled function against the decision and the prediction", () => {
    const project = tempProject();
    writeDecision(project);
    writeStub(project);
    run("stop", project);
    writeFileSync(path.join(project, "src", "store.ts"), `export function saveNote(): string {
  return "notes";
}
`);
    const waiting = run("session", project) as { additional_context?: string };
    assert.match(waiting.additional_context ?? "", /whether the result matched their sentence/);
    assert.equal(existsSync(path.join(project, ".praxis", "report.md")), false);

    writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: Where the data lives
Matched: yes
## End
`);
    run("stop", project);
    const report = readFileSync(path.join(project, ".praxis", "report.md"), "utf8");
    assert.ok(report.includes(reason));
    assert.ok(report.includes(prediction));
    assert.match(report, /Choice: one file/);
    assert.match(report, /Function: saveNote in src\/store\.ts/);
    assert.match(report, /Matched: yes/);

    writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: Where the data lives
Matched: no
## End
`);
    run("stop", project);
    assert.match(readFileSync(path.join(project, ".praxis", "report.md"), "utf8"), /Matched: no/);
    assert.ok(readFileSync(path.join(project, ".praxis", "report.md"), "utf8").includes(prediction));
  });

  it("allows a document to mention the mark", () => {
    const project = tempProject();
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: confirmed\nTopic: The stack\nBypass: none\n");
    writeFileSync(path.join(project, "README.md"), "The mark looks like TODO(praxis:...).\n");
    const allowed = run("gate", project, {
      tool_name: "Write",
      tool_input: {
        path: "README.md",
        contents: "The student writes the function marked TODO(praxis:<topic>).\n",
      },
    }) as { permission: string };
    assert.equal(allowed.permission, "allow");
  });

  it("does not call a function matched while the mark is still there", () => {
    const project = tempProject();
    writeDecision(project);
    writeStub(project);
    writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: Where the data lives
Matched: yes
## End
`);
    run("stop", project);
    assert.equal(existsSync(path.join(project, ".praxis", "report.md")), false);
    const waiting = run("session", project) as { additional_context?: string };
    assert.doesNotMatch(waiting.additional_context ?? "", /is in progress/);
  });

  it("keeps two marks that share a topic", () => {
    const project = tempProject();
    writeDecision(project);
    writeFileSync(path.join(project, "src", "store.ts"), `export function saveNote(): string {
  throw new Error("TODO(praxis:Where the data lives): implement persistence boundary");
}

export function listNotes(): string[] {
  throw new Error("TODO(praxis:Where the data lives): implement the query");
}
`);
    run("stop", project);
    const marks = readFileSync(path.join(project, ".praxis", "marks.md"), "utf8");
    assert.match(marks, /Function: saveNote/);
    assert.match(marks, /Function: listNotes/);
    assert.match(marks, /Description: implement persistence boundary/);
    assert.match(marks, /Description: implement the query/);

    const denied = run("gate", project, {
      tool_name: "StrReplace",
      tool_input: {
        path: "src/store.ts",
        old_string: 'throw new Error("TODO(praxis:Where the data lives): implement the query");',
        new_string: 'return [];',
      },
    }) as { permission: string };
    assert.equal(denied.permission, "deny");

    writeFileSync(path.join(project, "src", "store.ts"), `export function saveNote(): string {
  return "notes";
}

export function listNotes(): string[] {
  throw new Error("TODO(praxis:Where the data lives): implement the query");
}
`);
    writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: Where the data lives
Function: saveNote
Matched: yes
## End
`);
    run("stop", project);
    const report = readFileSync(path.join(project, ".praxis", "report.md"), "utf8");
    assert.match(report, /Function: saveNote in src\/store\.ts/);
    assert.match(report, /Matched: yes/);
    assert.doesNotMatch(report, /listNotes/);
  });

  it("treats a partial body as still in progress", () => {
    const project = tempProject();
    writeDecision(project);
    writeFileSync(path.join(project, "src", "store.ts"), `export function saveNote(): string {
  const notes = [];
  // TODO(praxis:Where the data lives): implement persistence boundary
  return notes;
}
`);
    writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: Where the data lives
Matched: yes
## End
`);
    const started = run("session", project) as { additional_context?: string };
    assert.match(started.additional_context ?? "", /saveNote in src\/store\.ts is in progress/);
    assert.match(started.additional_context ?? "", /The marker remains, so the learning boundary is still active/);
    assert.match(started.additional_context ?? "", /Offer the next small step/);
    assert.match(started.additional_context ?? "", /Do not write the rest of the function/);
    assert.equal(existsSync(path.join(project, ".praxis", "report.md")), false);
  });

  it("reviews a mark written with the decision id", () => {
    const project = tempProject();
    writeFileSync(path.join(project, ".praxis", "decisions.md"), `Goal: Notes API

## Decision
Topic: Where the data lives
Decision ID: storage-001
Context: Where notes are stored.
Options: one file | a database
Choice: one file
Date: 2026-11-14
Reason:
${reason}
Prediction:
${prediction}
## End
`);
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: confirmed\nTopic: Where the data lives\nDecision ID: storage-001\nBypass: none\n");
    writeFileSync(path.join(project, "src", "store.ts"), `export function saveNote(): string {
  throw new Error("TODO(praxis:storage-001)");
}
`);
    run("stop", project);
    assert.match(readFileSync(path.join(project, ".praxis", "marks.md"), "utf8"), /Topic: storage-001/);
    assert.match(readFileSync(path.join(project, "DECISIONS.md"), "utf8"), /\*\*Decision ID:\*\* storage-001/);
    writeFileSync(path.join(project, "src", "store.ts"), `export function saveNote(): string {
  return "notes";
}
`);
    writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: Where the data lives
Matched: yes
## End
`);
    run("stop", project);
    const report = readFileSync(path.join(project, ".praxis", "report.md"), "utf8");
    assert.match(report, /## Where the data lives/);
    assert.match(report, /Function: saveNote in src\/store\.ts/);
    assert.match(report, /Matched: yes/);
  });
});
