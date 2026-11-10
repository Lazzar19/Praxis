import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { addProjectQuestions, exportDecisions, recordAnswer, startSession } from "./flow.js";
import { planTodos, renderStub, reviewTodo, scaffoldTodos } from "./scaffold.js";
import { loadCoreTree } from "./tree.js";
import { sessionTracking, type Session } from "./types.js";

const directories: string[] = [];
const clock = () => new Date("2026-11-07T19:00:00.000Z");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "learn-coach-"));
  directories.push(directory);
  return directory;
}

const core = [
  { questionId: "stack", optionId: "node", reason: "The UI is JavaScript, so the class stays one language." },
  { questionId: "database", optionId: "sqlite", reason: "One file is enough while I am the only writer." },
  { questionId: "api", optionId: "rest", reason: "One client can call a few URLs." },
  { questionId: "auth", optionId: "none", reason: "The first version has no accounts.\nI will add them when notes are private." },
  { questionId: "deploy", optionId: "local", reason: "Only I run it this week." },
] as const;

const projectQuestion = {
  id: "realtime",
  area: "api" as const,
  title: "Live updates",
  prompt: "How should a second tab see a new note?",
  options: [
    { id: "poll", label: "Polling", pros: ["One request shape."], cons: ["The other tab waits."] },
    { id: "socket", label: "WebSocket", pros: ["The other tab updates immediately."], cons: ["The server holds a connection."] },
  ],
  recommendation: { beginner: "poll" as const, intermediate: "poll" as const, advanced: "socket" as const },
  whyRubric: ["names how the second tab hears about a note"],
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("TODO scaffold", () => {
  it("maps one stub to each plan step and reviews the student function against that decision", () => {
    const project = tempProject();
    const options = { projectRoot: project, clock };
    startSession(options, { goal: "Notes API" });
    assert.throws(() => scaffoldTodos(options), /Export the decisions/);
    addProjectQuestions(options, { questions: [projectQuestion] });
    for (const answer of core) recordAnswer(options, answer);
    const extraReason = "Polling is enough while one person has the notes open.";
    recordAnswer(options, { questionId: "realtime", optionId: "poll", reason: extraReason });
    exportDecisions(options);

    const scaffolded = scaffoldTodos(options);
    assert.equal(scaffolded.todoCount, 6);
    assert.equal(scaffolded.written.length, 6);
    const plan = readFileSync(path.join(project, "PLAN.md"), "utf8");
    const files = ["stack", "database", "api", "auth", "deploy", "realtime"];
    for (const [index, id] of files.entries()) {
      const file = path.join(project, "src", `${id}.ts`);
      const source = readFileSync(file, "utf8");
      const marker = `TODO(learn-coach:${id})`;
      assert.equal(source.split(marker).length - 1, 1);
      const open = reviewTodo(options, id);
      assert.equal(open.status, "open");
      assert.equal(open.questionId, id);
      assert.match(source, new RegExp(`Decision ${index + 1}: ${open.title}`));
      assert.ok(plan.includes(`${index + 1}. ${open.title}`));
    }

    const stackReason = core[0].reason;
    const written = "export function implementStack(): string {\n  return \"node for the notes UI\";\n}\n";
    writeFileSync(path.join(project, "src", "stack.ts"), written);
    const ready = reviewTodo(options, "stack");
    assert.equal(ready.status, "ready");
    assert.equal(ready.title, "Server language");
    assert.equal(ready.optionId, "node");
    assert.equal(ready.choice, "Node.js");
    assert.equal(ready.reason, stackReason);
    assert.equal(ready.source, written);
    assert.equal(reviewTodo(options, "database").reason, core[1].reason);
    assert.notEqual(reviewTodo(options, "database").reason, stackReason);

    const auth = readFileSync(path.join(project, "src", "auth.ts"), "utf8");
    assert.match(auth, /The first version has no accounts\./);
    assert.match(auth, /I will add them when notes are private\./);
    const extra = reviewTodo(options, "realtime");
    assert.equal(extra.reason, extraReason);
    assert.equal(extra.file, "src/realtime.ts");

    const again = scaffoldTodos(options);
    assert.deepEqual(again.kept, ["src/stack.ts"]);
    assert.equal(readFileSync(path.join(project, "src", "stack.ts"), "utf8"), written);
    assert.equal(again.written.length, 5);
  });

  it("refuses full generation and follows the stack language", () => {
    const project = tempProject();
    const options = { projectRoot: project, clock };
    startSession(options, { goal: "Notes API", handsOn: "full" });
    for (const answer of core) recordAnswer(options, { ...answer, optionId: answer.questionId === "stack" ? "python" : answer.optionId });
    exportDecisions(options);
    assert.throws(() => scaffoldTodos(options), /Full generation is not available/);
    assert.equal(existsSync(path.join(project, "src")), false);
    assert.equal(existsSync(path.join(project, ".praxis", "todos.json")), false);

    const tree = loadCoreTree();
    const answeredAt = "2026-11-07T19:00:00.000Z";
    const session: Session = {
      version: 1,
      goal: "Notes API",
      levels: { stack: "intermediate", database: "intermediate", api: "intermediate", auth: "intermediate", deploy: "intermediate" },
      handsOn: "todos",
      answers: tree.map((question) => ({
        questionId: question.id,
        optionId: question.id === "stack" ? "go" : question.recommendation.intermediate,
        reason: "Because this project needs it.",
        answeredAt,
      })),
      startedAt: answeredAt,
      exportedAt: answeredAt,
      ...sessionTracking(),
    };
    const todos = planTodos(session, tree);
    assert.ok(todos.every((todo) => todo.file.endsWith(".go")));
    assert.equal(todos[0]?.functionName, "ImplementStack");
    assert.match(renderStub(todos[0]!, 1), /func ImplementStack\(\)/);
    assert.equal(planTodos({
      ...session,
      answers: session.answers.map((answer) => answer.questionId === "stack" ? { ...answer, optionId: "python" } : answer),
    }, tree)[1]?.file, "src/database.py");
  });

  it("refuses a TODO path that leaves the project", () => {
    const project = tempProject();
    const options = { projectRoot: project, clock };
    startSession(options, { goal: "Notes API" });
    for (const answer of core) recordAnswer(options, answer);
    exportDecisions(options);
    scaffoldTodos(options);
    writeFileSync(path.join(project, ".praxis", "todos.json"), `${JSON.stringify({
      version: 1,
      todos: [{ questionId: "stack", file: "../secrets.txt", functionName: "implementStack", marker: "TODO(learn-coach:stack)" }],
    }, null, 2)}\n`);
    assert.throws(() => reviewTodo(options, "stack"), /escapes the project/);
  });
});
