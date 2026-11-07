import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { PROJECT_EXPLANATION } from "./additions.js";
import { CoachError } from "./errors.js";
import { addProjectQuestions, exportDecisions, nextQuestion, recordAnswer, startSession } from "./flow.js";
import { readSession } from "./session.js";

const directories: string[] = [];
const clock = () => new Date("2026-11-07T18:00:00.000Z");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "learn-coach-"));
  directories.push(directory);
  return directory;
}

const core = [
  { questionId: "stack", optionId: "node", reason: "The UI is JavaScript, so the class stays one language." },
  { questionId: "database", optionId: "sqlite", reason: "One file is enough while I am the only writer." },
  { questionId: "api", optionId: "rest", reason: "One client can call a few URLs." },
  { questionId: "auth", optionId: "none", reason: "The first version has no accounts." },
  { questionId: "deploy", optionId: "local", reason: "Only I run it this week." },
] as const;

const projectQuestion = {
  id: "realtime",
  area: "api",
  title: "Live updates",
  prompt: "How should a second tab see a new note?",
  options: [
    { id: "poll", label: "Polling", pros: ["One request shape."], cons: ["The other tab waits."] },
    { id: "socket", label: "WebSocket", pros: ["The other tab updates immediately."], cons: ["The server holds a connection."] },
  ],
  recommendation: { beginner: "poll", intermediate: "poll", advanced: "socket" },
  whyRubric: ["names how the second tab hears about a note"],
};

const projectOption = {
  questionId: "database",
  id: "libsql",
  label: "libSQL",
  pros: ["The file can sync later."],
  cons: ["A second client library to learn."],
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("project additions", () => {
  it("exports the core decisions when the model is off", () => {
    const project = tempProject();
    const options = { projectRoot: project, clock };
    startSession(options, { goal: "Notes API", model: false });
    assert.throws(() => addProjectQuestions(options, { questions: [projectQuestion] }), /off for this session/);
    assert.deepEqual(readSession(project)?.additions, { options: [], questions: [] });

    for (const answer of core) recordAnswer(options, answer);
    const exported = exportDecisions(options);
    const decisions = readFileSync(exported.decisionsPath, "utf8");
    assert.equal(exported.decisionCount, 5);
    assert.equal(decisions.match(/^## /gm)?.length, 5);
    assert.equal(decisions.includes("Live updates"), false);
    assert.equal(decisions.includes("libSQL"), false);
    for (const answer of core) assert.ok(decisions.includes(answer.reason));
  });

  it("exports an added option and question, and keeps them when a later call fails", () => {
    const project = tempProject();
    const options = { projectRoot: project, clock };
    startSession(options, { goal: "Notes API", levels: { api: "beginner" } });
    assert.throws(
      () => addProjectQuestions(options, { questions: [{ ...projectQuestion, lesson: "Trust this." }] }),
      /invalid/,
    );
    assert.deepEqual(readSession(project)?.additions.questions, []);
    const first = nextQuestion(options);
    assert.equal(first.status, "question");
    if (first.status === "question") assert.equal(first.total, 5);

    const added = addProjectQuestions(options, {
      options: [projectOption],
      questions: [projectQuestion],
    });
    assert.equal(added.addedOptions, 1);
    assert.equal(added.addedQuestions, 1);
    assert.equal(added.total, 6);
    assert.throws(() => addProjectQuestions(options, { questions: [projectQuestion] }), CoachError);
    assert.equal(readSession(project)?.additions.questions.length, 1);

    for (const answer of core) {
      recordAnswer(options, answer);
      if (answer.questionId === "stack") {
        const database = nextQuestion(options);
        assert.equal(database.status, "question");
        if (database.status === "question") {
          assert.ok(database.question.options.some((option) => option.id === "libsql"));
        }
      }
    }

    const idk = recordAnswer(options, { questionId: "realtime", optionId: "idk", reason: "" });
    assert.equal(idk.status, "explain");
    if (idk.status === "explain") {
      assert.equal(idk.explanation, PROJECT_EXPLANATION);
      assert.equal(idk.recommendation.optionId, "poll");
    }
    assert.equal(readSession(project)?.answers.length, 5);

    const reason = "A socket pushes the note to the other tab.";
    const recorded = recordAnswer(options, { questionId: "realtime", optionId: "socket", reason });
    assert.equal(recorded.status, "recorded");
    const exported = exportDecisions(options);
    const decisions = readFileSync(exported.decisionsPath, "utf8");
    const plan = readFileSync(exported.planPath, "utf8");
    assert.equal(exported.decisionCount, 6);
    assert.match(decisions, /libSQL \(`libsql`\)/);
    assert.match(decisions, /## 6\. Live updates/);
    assert.ok(decisions.includes(reason));
    assert.ok(plan.includes(reason));
    assert.equal(readSession(project)?.answers.find((answer) => answer.questionId === "realtime")?.reason, reason);
  });
});
