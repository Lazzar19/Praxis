import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { CoachError } from "./errors.js";
import { exportDecisions, nextQuestion, recordAnswer, startSession } from "./flow.js";
import { packageRoot } from "./paths.js";
import { readSession } from "./session.js";

const directories: string[] = [];
const clock = () => new Date("2026-11-04T15:00:00.000Z");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "learn-coach-"));
  directories.push(directory);
  return directory;
}

const answers = [
  { questionId: "stack", optionId: "node", reason: "The UI is JavaScript, so {{goal}} stays one language." },
  { questionId: "database", optionId: "sqlite", reason: "  One file is enough while I am the only writer.  " },
  { questionId: "api", optionId: "rest", reason: "One client can call a few URLs." },
  { questionId: "auth", optionId: "none", reason: "The first version has no accounts.\nI will add them when notes are private." },
  { questionId: "deploy", optionId: "local", reason: "Only I run it this week." },
] as const;

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("session flow", () => {
  it("walks the core tree and writes the student's words", () => {
    const project = tempProject();
    const options = { projectRoot: project, clock };
    const started = startSession(options, {
      goal: "  Notes API  ",
      levels: { database: "beginner", stack: "advanced" },
    });
    assert.equal(started.status, "created");
    assert.equal(started.goal, "Notes API");
    assert.equal(started.handsOn, "todos");
    assert.equal(started.levels.stack, "advanced");
    assert.equal(started.levels.api, "intermediate");

    const first = nextQuestion(options);
    assert.equal(first.status, "question");
    if (first.status !== "question") return;
    assert.equal(first.question.id, "stack");
    assert.equal(first.question.level, "advanced");
    assert.equal(first.question.recommendation.optionId, "go");

    assert.throws(() => recordAnswer(options, answers[1]), /current question is "stack"/);
    assert.throws(() => recordAnswer(options, { ...answers[0], reason: "   " }), /reason is required/);
    assert.throws(() => recordAnswer(options, { ...answers[0], optionId: "cobol" }), /not an option/);

    for (const answer of answers) {
      recordAnswer(options, answer);
    }

    assert.equal(nextQuestion(options).status, "ready");
    assert.throws(() => recordAnswer(options, answers[0]), /already has an answer/);

    const exported = exportDecisions(options);
    const decisions = readFileSync(exported.decisionsPath, "utf8");
    const plan = readFileSync(exported.planPath, "utf8");
    const stored = readSession(project);
    assert.ok(stored);
    assert.equal(stored.exportedAt, "2026-11-04T15:00:00.000Z");
    assert.equal(stored.answers.length, 5);
    for (const answer of answers) {
      assert.ok(decisions.includes(answer.reason));
      assert.ok(plan.includes(answer.reason));
      assert.equal(stored.answers.find((item) => item.questionId === answer.questionId)?.reason, answer.reason);
    }
    assert.ok(decisions.includes("- **Choice:** SQLite (`sqlite`)"));
    assert.equal(startSession(options, { goal: "Other" }).status, "exists");
    assert.equal(readSession(project)?.goal, "Notes API");
  });

  it("does not export a partial session or write into the coach repo", () => {
    const project = tempProject();
    const options = { projectRoot: project, clock };
    startSession(options, { goal: "Notes API" });
    assert.throws(() => exportDecisions(options), /Export waits for/);
    assert.throws(() => startSession({ projectRoot: packageRoot(), clock }, { goal: "Notes API" }), CoachError);
  });
});
