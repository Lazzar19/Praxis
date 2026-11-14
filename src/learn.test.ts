import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-learn-"));
  directories.push(directory);
  mkdirSync(path.join(directory, ".praxis"));
  mkdirSync(path.join(directory, "src"));
  return directory;
}

function run(command: string, project: string, stateDir: string): { additional_context?: string } {
  const result = spawnSync(process.execPath, [hook, command], {
    input: "{}",
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: project, PRAXIS_STATE_DIR: stateDir },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { additional_context?: string };
}

function decision(topic: string, choice: string): string {
  return `## Decision
Topic: ${topic}
Context: A step.
Options: keep theirs | take the proposal | mix the two
Choice: ${choice}
Date: 2026-11-14
Reason:
Because ${choice}.
Prediction:
It returns the id.
## End`;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("learning review, level, and progress", () => {
  it("publishes a partial review with both alignments, evidence, and a next question", () => {
    const project = tempProject();
    const stateDir = path.join(project, ".praxis-state");
    writeFileSync(path.join(project, ".praxis", "decisions.md"), `Goal: Notes API

${decision("Where the data lives", "take the proposal")}
`);
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: confirmed\nTopic: Where the data lives\nBypass: none\n");
    writeFileSync(path.join(project, "src", "store.ts"), `export function saveNote(): string {
  throw new Error("TODO(praxis:Where the data lives)");
}
`);
    run("stop", project, stateDir);
    writeFileSync(path.join(project, "src", "store.ts"), `export function saveNote(): string {
  return "notes";
}
`);
    writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: Where the data lives
Decision alignment: yes
Prediction alignment: partial
Matched: partial
Evidence:
- The function stores the note.
- It does not return the generated id.
Next question:
- Where should the returned id be generated?
## End
`);
    run("stop", project, stateDir);
    const report = readFileSync(path.join(project, ".praxis", "report.md"), "utf8");
    assert.match(report, /Decision alignment: yes/);
    assert.match(report, /Prediction alignment: partial/);
    assert.match(report, /Matched: partial/);
    assert.match(report, /The function stores the note/);
    assert.match(report, /Where should the returned id be generated/);
  });

  it("shrinks the next step after missed predictions, unless adaptation is off", () => {
    const project = tempProject();
    const stateDir = path.join(project, ".praxis-state");
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: pending\nTopic: the problem\nLevel: beginner\nBypass: none\n");
    writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: Where the data lives
Matched: no
## End

## Review
Topic: How it ships
Matched: partial
## End
`);
    const adapted = run("session", project, stateDir).additional_context ?? "";
    assert.match(adapted, /more definitions, smaller steps/);
    assert.match(adapted, /Reduce the size of the next step/);

    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: pending\nTopic: the problem\nLevel: beginner\nAdapt: off\nBypass: none\n");
    const held = run("session", project, stateDir).additional_context ?? "";
    assert.match(held, /more definitions, smaller steps/);
    assert.match(held, /Adaptation is off/);
    assert.doesNotMatch(held, /Reduce the size of the next step/);
  });

  it("asks for a comparison or a grounding question from repeated answers", () => {
    const project = tempProject();
    const stateDir = path.join(project, ".praxis-state");
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: pending\nTopic: the problem\nBypass: none\n");
    writeFileSync(path.join(project, ".praxis", "decisions.md"), `Goal: Notes API

${decision("Where the data lives", "take the proposal")}

${decision("How it ships", "take the proposal")}
`);
    const compared = run("session", project, stateDir).additional_context ?? "";
    assert.match(compared, /compare two alternatives/);

    writeFileSync(path.join(project, ".praxis", "decisions.md"), `Goal: Notes API

${decision("Where the data lives", "idk")}

${decision("How it ships", "idk")}
`);
    const grounded = run("session", project, stateDir).additional_context ?? "";
    assert.match(grounded, /grounding question/);
  });

  it("shares opted-in practice with the next project and deletes it on clear", () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "praxis-learn-state-"));
    directories.push(stateDir);
    const first = tempProject();
    writeFileSync(path.join(first, ".praxis", "progress.md"), "Status: confirmed\nTopic: Where the data lives\nProgress: on\nBypass: none\n");
    writeFileSync(path.join(first, ".praxis", "decisions.md"), `Goal: Family expense tracker

${decision("Where the data lives", "take the proposal")}
`);
    writeFileSync(path.join(first, ".praxis", "review.md"), `## Review
Topic: Where the data lives
Matched: yes
## End
`);
    run("stop", first, stateDir);
    assert.equal(existsSync(path.join(stateDir, "learning.json")), true);

    const second = tempProject();
    writeFileSync(path.join(second, ".praxis", "progress.md"), "Status: pending\nTopic: their sentence\nProgress: on\nBypass: none\n");
    const heard = run("session", second, stateDir).additional_context ?? "";
    assert.match(heard, /Local progress is on, and it stays on this computer/);
    assert.match(heard, /Family expense tracker: Where the data lives \(yes 1\)/);
    assert.match(heard, /Do not send this record to an external service/);

    const quiet = tempProject();
    writeFileSync(path.join(quiet, ".praxis", "progress.md"), "Status: pending\nTopic: their sentence\nBypass: none\n");
    assert.doesNotMatch(run("session", quiet, stateDir).additional_context ?? "", /Past practice/);

    writeFileSync(path.join(second, ".praxis", "progress.md"), "Status: pending\nTopic: their sentence\nProgress: clear\nBypass: none\n");
    const cleared = run("session", second, stateDir).additional_context ?? "";
    assert.match(cleared, /Local progress was deleted/);
    assert.equal(existsSync(path.join(stateDir, "learning.json")), false);
  });
});
