import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-timeline-"));
  directories.push(directory);
  mkdirSync(path.join(directory, ".praxis"), { recursive: true });
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

describe("decision timeline", () => {
  it("keeps note order, attaches the review to its decision, and stays quiet without decisions", () => {
    const quiet = tempProject();
    writeFileSync(path.join(quiet, ".praxis", "progress.md"), "Status: pending\nTopic: where the data lives\nBypass: none\n");
    const quietSession = run("session", quiet);
    assert.equal(existsSync(path.join(quiet, ".praxis", "timeline.md")), false);
    assert.doesNotMatch(quietSession.additional_context ?? "", /timeline\.md/);

    const project = tempProject();
    writeFileSync(path.join(project, ".praxis", "decisions.md"), `Goal: Family expense tracker

## Decision
Topic: Where the data lives
Decision ID: storage-001
Choice: take the proposal
Date: 2026-11-16
Reason:
SQLite on the laptop
Prediction:
It returns the generated id.
## End

## Decision
Topic: How it ships
Choice: one port
Date: 2026-11-01
Reason:
Classmates on the same laptop
## End
`);
    writeFileSync(path.join(project, ".praxis", "review.md"), `## Review
Topic: How it ships
Decision alignment: yes
Prediction alignment: no
Matched: no
## End
`);
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Status: pending\nTopic: Who may see it\nBypass: none\n");
    const started = run("session", project);
    const timeline = readFileSync(path.join(project, ".praxis", "timeline.md"), "utf8");
    const first = timeline.indexOf("## 1. Where the data lives");
    const second = timeline.indexOf("## 2. How it ships");
    assert.ok(first >= 0 && second > first);
    assert.match(timeline.slice(first, second), /Choice:\*\* take the proposal/);
    assert.match(timeline.slice(first, second), /SQLite on the laptop/);
    assert.doesNotMatch(timeline.slice(first, second), /Matched:/);
    assert.match(timeline.slice(second), /Date:\*\* 2026-11-01/);
    assert.match(timeline.slice(second), /Matched:\*\* no/);
    assert.match(timeline.slice(second), /Decision alignment:\*\* yes/);
    assert.match(timeline, /## Open[\s\S]*Who may see it[\s\S]*pending/);
    assert.match(started.additional_context ?? "", /open that file beside the chat/);
    assert.match(started.additional_context ?? "", /Do not paste the timeline into the chat/);
  });
});
