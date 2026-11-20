import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-recall-"));
  directories.push(directory);
  mkdirSync(path.join(directory, ".praxis"), { recursive: true });
  return directory;
}

function run(project: string): string {
  const result = spawnSync(process.execPath, [hook, "session"], {
    input: "{}",
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: project, PRAXIS_STATE_DIR: path.join(project, ".praxis-state") },
  });
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { additional_context?: string }).additional_context ?? "";
}

function notes(project: string, status: string): void {
  writeFileSync(path.join(project, ".praxis", "progress.md"), `Status: ${status}\nTopic: Where the data lives\nBypass: none\n`);
  writeFileSync(path.join(project, ".praxis", "decisions.md"), `## Decision
Topic: Where the data lives
Decision ID: storage-001
Choice: take the proposal
Reason:
SQLite on the laptop
Prediction:
It returns the generated id.
## End

## Decision
Topic: How it ships
Choice: one port
Reason:
The same laptop
Prediction:
It listens on one port.
## End
`);
  writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: Where the data lives
Matched: yes
## End

## Review
Topic: How it ships
Matched: partial
## End
`);
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("recall question", () => {
  it("asks one confirmed review later, then follows an answer that does not hold", () => {
    const pending = tempProject();
    notes(pending, "pending");
    assert.doesNotMatch(run(pending), /Recall one decision/);

    const project = tempProject();
    notes(project, "confirmed");
    const asked = run(project);
    assert.match(asked, /Topic: Where the data lives/);
    assert.match(asked, /Prediction: It returns the generated id\./);
    assert.match(asked, /it holds, or it does not hold/);
    assert.doesNotMatch(asked, /How it ships/);

    writeFileSync(path.join(project, ".praxis", "recall.md"), `## Recall
Topic: Where the data lives
Answer: The id still comes back.
Holds: yes
## End
`);
    const next = run(project);
    assert.match(next, /Topic: How it ships/);
    assert.match(next, /It listens on one port/);
    assert.doesNotMatch(next, /It returns the generated id/);

    writeFileSync(path.join(project, ".praxis", "recall.md"), `## Recall
Topic: Where the data lives
Answer: The id still comes back.
Holds: yes
## End

## Recall
Topic: How it ships
Answer: The port is gone.
Holds: no
## End
`);
    const missed = run(project);
    assert.match(missed, /The recall for How it ships did not hold/);
    assert.match(missed, /Answer: The port is gone/);
    assert.match(missed, /Topic: what changed/);
    assert.doesNotMatch(missed, /Recall one decision/);
  });
});
