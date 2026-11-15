import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-export-"));
  directories.push(directory);
  mkdirSync(path.join(directory, ".praxis"));
  mkdirSync(path.join(directory, "src"));
  mkdirSync(path.join(directory, "tests"));
  return directory;
}

function run(command: string, project: string): { additional_context?: string } {
  const result = spawnSync(process.execPath, [hook, command], {
    input: "{}",
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: project, PRAXIS_STATE_DIR: path.join(project, ".praxis-state") },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { additional_context?: string };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("test evidence and export", () => {
  it("counts a bounded test run without changing the function, then exports the review", () => {
    const project = tempProject();
    const reason = "SECRET-REASON stays in the portfolio only";
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
It returns the generated id.
## End
`);
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: confirmed\nTopic: Where the data lives\nDecision ID: storage-001\nBypass: none\n");
    const source = `export function saveNote(): string {
  throw new Error("TODO(praxis:storage-001)");
}
`;
    writeFileSync(path.join(project, "src", "store.ts"), source);
    run("stop", project);
    const finished = `export function saveNote(): string {
  return "notes";
}
`;
    writeFileSync(path.join(project, "src", "store.ts"), finished);
    writeFileSync(path.join(project, "tests", "saveNote.test.mjs"), `import test from "node:test";
import assert from "node:assert/strict";
test("saveNote keeps the note", () => { assert.equal(1, 1); });
test("saveNote returns an id", () => { assert.equal(1, 2); });
`);
    writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: Where the data lives
Decision alignment: yes
Prediction alignment: partial
Matched: partial
Evidence:
- The function stores the note.
- The generated id is not returned.
## End
`);
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: confirmed\nTopic: Where the data lives\nDecision ID: storage-001\nTests: run\nBypass: none\n");
    const started = run("session", project);
    assert.match(started.additional_context ?? "", /- 1 passed\n- 1 failed/);
    assert.match(started.additional_context ?? "", /The marked function was not changed/);
    assert.equal(readFileSync(path.join(project, "src", "store.ts"), "utf8"), finished);
    assert.match(readFileSync(path.join(project, ".praxis", "progress.md"), "utf8"), /Tests: done/);

    const again = run("session", project);
    assert.match(again.additional_context ?? "", /- 1 passed/);
    assert.match(readFileSync(path.join(project, ".praxis", "progress.md"), "utf8"), /Tests: done/);

    const review = JSON.parse(readFileSync(path.join(project, ".praxis", "export", "review.json"), "utf8")) as {
      reviews: { decisionId: string; decisionAlignment: string; predictionAlignment: string; evidence: string[] }[];
      tests: { passed: number; failed: number };
    };
    assert.equal(review.reviews[0]?.decisionId, "storage-001");
    assert.equal(review.reviews[0]?.decisionAlignment, "yes");
    assert.equal(review.reviews[0]?.predictionAlignment, "partial");
    assert.deepEqual(review.reviews[0]?.evidence, ["The function stores the note.", "The generated id is not returned."]);
    assert.equal(review.tests.passed, 1);
    assert.equal(review.tests.failed, 1);
    assert.match(readFileSync(path.join(project, ".praxis", "export", "portfolio.md"), "utf8"), new RegExp(reason));
    assert.doesNotMatch(readFileSync(path.join(project, ".praxis", "export", "summary.json"), "utf8"), new RegExp(reason));
    assert.match(readFileSync(path.join(project, ".praxis", "export", "stats.csv"), "utf8"), /decision_alignment/);
    assert.equal(JSON.parse(readFileSync(path.join(project, ".praxis", "export", "session.json"), "utf8")).decisionId, "storage-001");
  });
});
