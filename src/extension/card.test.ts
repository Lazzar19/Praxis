import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { applyCardMessage, cardState, parseCardMessage } from "./card.js";
import { cardDocument } from "./document.js";
import { recordAnswer, startSession } from "../flow.js";
import { packageRoot } from "../paths.js";
import { readSession } from "../session.js";

const directories: string[] = [];
const clock = () => new Date("2026-11-07T09:00:00.000Z");
const reason = "The UI is JavaScript, so {{goal}} stays one language.";

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-card-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("question card", () => {
  it("matches a tool answer in the session file", () => {
    const viaCard = tempProject();
    const viaTool = tempProject();
    const card = { projectRoot: viaCard, clock };
    const tool = { projectRoot: viaTool, clock };

    const started = applyCardMessage(card, { type: "start", goal: "  Notes API  " });
    assert.equal(started.kind, "question");
    if (started.kind !== "question") return;
    assert.equal(started.progress, "Question 1 of 5");
    assert.equal(started.selectedOptionId, "");

    const html = cardDocument(started, "nonce");
    assert.equal(html.match(/class="progress"/g)?.length, 1);
    assert.match(html, /Question 1 of 5/);
    assert.match(html, /Suggested for intermediate: Node\.js/);
    assert.doesNotMatch(html, /checked/);

    const answered = applyCardMessage(card, {
      type: "answer",
      questionId: "stack",
      optionId: "node",
      reason,
    });
    assert.equal(answered.kind, "question");
    if (answered.kind !== "question") return;
    assert.equal(answered.progress, "Question 2 of 5");

    startSession(tool, { goal: "Notes API" });
    recordAnswer(tool, { questionId: "stack", optionId: "node", reason });
    assert.deepEqual(readSession(viaCard), readSession(viaTool));
  });

  it("keeps the draft when the reason is empty and does not write it", () => {
    const project = tempProject();
    const deps = { projectRoot: project, clock };
    applyCardMessage(deps, { type: "start", goal: "Notes API" });
    const failed = applyCardMessage(deps, {
      type: "answer",
      questionId: "stack",
      optionId: "node",
      reason: "   ",
    });
    assert.equal(failed.kind, "question");
    if (failed.kind !== "question") return;
    assert.match(failed.error ?? "", /reason is required/);
    assert.equal(failed.reason, "   ");
    assert.equal(readSession(project)?.answers.length, 0);
    const html = cardDocument(failed, "nonce");
    assert.match(html, /checked/);
    assert.match(html, /reason is required/);
  });

  it("keeps a self-rating and walks I don't know on the card", () => {
    const project = tempProject();
    const deps = { projectRoot: project, clock };
    const started = applyCardMessage(deps, {
      type: "start",
      goal: "Notes API",
      levels: { stack: "beginner", database: "advanced" },
    });
    assert.equal(started.kind, "question");
    assert.equal(readSession(project)?.levels.stack, "beginner");
    assert.equal(readSession(project)?.levels.database, "advanced");
    assert.equal(readSession(project)?.levels.api, "intermediate");
    if (started.kind !== "question") return;
    const html = cardDocument(started, "nonce");
    assert.match(html, /data-type="idk"/);

    const step = applyCardMessage(deps, { type: "idk", questionId: "stack" });
    assert.equal(step.kind, "subquestion");
    assert.equal(readSession(project)?.answers.length, 0);
    if (step.kind !== "subquestion") return;
    assert.match(cardDocument(step, "nonce"), /smaller question/);
  });

  it("shows the hint and stores the second reason from the card", () => {
    const project = tempProject();
    const deps = { projectRoot: project, clock };
    startSession(deps, { goal: "Notes API" });
    const hinted = applyCardMessage(deps, {
      type: "answer",
      questionId: "stack",
      optionId: "node",
      reason: "Python is easier to read for this class",
    });
    assert.equal(hinted.kind, "question");
    if (hinted.kind !== "question") return;
    assert.match(hinted.hint ?? "", /names the language they chose/);
    assert.equal(hinted.reason, "Python is easier to read for this class");
    assert.equal(hinted.selectedOptionId, "node");
    assert.match(cardDocument(hinted, "nonce"), /class="hint"/);
    assert.equal(readSession(project)?.answers.length, 0);

    const stored = applyCardMessage(deps, {
      type: "answer",
      questionId: "stack",
      optionId: "node",
      reason: "Python is still what I want here",
    });
    assert.equal(stored.kind, "question");
    assert.equal(readSession(project)?.answers[0]?.reason, "Python is still what I want here");
    assert.equal(readSession(project)?.answers[0]?.optionId, "node");
  });

  it("escapes question text and refuses the coach repository", () => {
    const html = cardDocument({
      kind: "question",
      progress: "Question 1 of 5",
      questionId: "stack",
      title: "<script>",
      prompt: "A & B",
      suggestion: "Suggested",
      options: [],
      selectedOptionId: "",
      reason: "</textarea>",
    }, "nonce");
    assert.match(html, /<h1>&lt;script&gt;<\/h1>/);
    assert.match(html, /A &amp; B/);
    assert.match(html, /&lt;\/textarea&gt;/);

    const blocked = cardState({ projectRoot: packageRoot() });
    assert.match(blocked.error ?? "", /student project/);
  });

  it("ignores a message that is not a card action", () => {
    assert.equal(parseCardMessage(null), null);
    assert.equal(parseCardMessage({ type: "answer", questionId: "stack" }), null);
    assert.deepEqual(parseCardMessage({ type: "export" }), { type: "export" });
  });
});
