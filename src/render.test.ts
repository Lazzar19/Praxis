import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDecisionDate, renderExport } from "./render.js";
import { fillTemplate } from "./template.js";
import { loadCoreTree } from "./tree.js";
import type { Session } from "./types.js";

const reason = "The UI is JavaScript, so {{goal}} stays one language.";

describe("templates", () => {
  it("inserts values once, leaving braces inside a reason untouched", () => {
    const filled = fillTemplate("Goal {{goal}}\n{{reason}}", { goal: "Notes", reason });
    assert.equal(filled, `Goal Notes\n${reason}`);
  });

  it("copies the choice and the reason into both exports", () => {
    const tree = loadCoreTree();
    const answeredAt = "2026-11-04T15:00:00.000Z";
    const session: Session = {
      version: 1,
      goal: "Notes API",
      levels: {
        stack: "intermediate",
        database: "beginner",
        api: "intermediate",
        auth: "intermediate",
        deploy: "intermediate",
      },
      handsOn: "todos",
      answers: [
        { questionId: "stack", optionId: "node", reason, answeredAt },
        { questionId: "database", optionId: "sqlite", reason: "  One file is enough.  ", answeredAt },
        { questionId: "api", optionId: "rest", reason: "curl is enough for one client.", answeredAt },
        { questionId: "auth", optionId: "sessions", reason: "I want to see the cookie.", answeredAt },
        { questionId: "deploy", optionId: "managed", reason: "Classmates need a URL.", answeredAt },
      ],
      startedAt: answeredAt,
      exportedAt: null,
    };

    const rendered = renderExport(session, tree);
    assert.match(rendered.decisions, /^# Decisions\n/);
    assert.ok(rendered.decisions.includes("Project goal: Notes API"));
    assert.ok(rendered.decisions.includes(reason));
    assert.ok(rendered.decisions.includes("  One file is enough.  "));
    assert.ok(rendered.decisions.includes("- **Choice:** SQLite (`sqlite`)"));
    assert.equal(
      rendered.decisions.split("\n").find((line) => line.startsWith("- **Choice:**") && line.includes("PostgreSQL")),
      undefined,
    );
    assert.ok(rendered.decisions.includes(`- **Date:** ${formatDecisionDate(answeredAt)}`));
    assert.ok(rendered.plan.includes("1. Server language — Node.js (`node`)"));
    assert.ok(rendered.plan.includes(reason));
    assert.ok(rendered.plan.includes("Hands-on mode: todos."));
  });
});
