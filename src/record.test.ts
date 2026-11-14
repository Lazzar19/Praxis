import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { parseDecisions, renderDecisions, selectMapFiles, syncMap } from "../hooks/record.mjs";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");
const templates = {
  page: readFileSync(new URL("../templates/decisions.md", import.meta.url), "utf8"),
  entry: readFileSync(new URL("../templates/decision-entry.md", import.meta.url), "utf8"),
};

const reasons = [
  "I have shipped one class project.",
  "  One file is enough.  ",
  "The UI is JavaScript, so {{goal}} stays one language.",
  "The first version has no accounts.\nI will add them when notes are private.",
  "Only I run it this week.",
];

const topics = [
  "Their level",
  "The stack",
  "Where the data lives",
  "Who may see or change it",
  "How it ships",
];

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-record-"));
  directories.push(directory);
  mkdirSync(path.join(directory, ".praxis"));
  return directory;
}

function notes(): string {
  const blocks = topics.map((topic, index) => `## Decision
Topic: ${topic}
Context: What ${topic.toLowerCase()} changes for Notes API.
Options: one way | another way
Choice: one way
Date: 2026-11-08
Reason:
${reasons[index]}
## End`);
  return `Goal: Notes API\n\n${blocks.join("\n\n")}\n`;
}

function run(command: string, project: string): { parsed: unknown; stdout: string } {
  const result = spawnSync(process.execPath, [hook, command], {
    input: "{}",
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: project },
  });
  assert.equal(result.status, 0, result.stderr);
  return { parsed: JSON.parse(result.stdout), stdout: result.stdout };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("decision record", () => {
  it("exports five floor topics with the reasons from the notes", () => {
    const project = tempProject();
    const source = notes();
    writeFileSync(path.join(project, ".praxis", "decisions.md"), source);
    const rendered = renderDecisions(source, templates);
    for (const reason of reasons) assert.ok(rendered.includes(reason), reason);
    assert.equal(parseDecisions(source).decisions.map((decision) => decision.reason).join("\n"), reasons.join("\n"));
    run("stop", project);
    run("stop", project);
    const decisions = readFileSync(path.join(project, "DECISIONS.md"), "utf8");
    assert.equal(decisions.match(/^## /gm)?.length, 5);
    for (const reason of reasons) assert.ok(decisions.includes(reason), reason);
    assert.match(decisions, /Project goal: Notes API/);
    assert.match(decisions, /## 1\. Their level/);
    assert.match(decisions, /## 5\. How it ships/);
    assert.doesNotMatch(decisions, /\*\*Their sentence:\*\*/);
  });

  it("exports a debate round verbatim and omits an empty level round", () => {
    const project = tempProject();
    const sentence = "  One file on the classroom computer.  ";
    const problem = "A classmate opens that file and reads someone else's notes.";
    const reply = "I would split the file later.\n{{goal}} stays in the reply.";
    const proposal = "A database on the same machine, with one account per student.";
    const source = `Goal: Notes API

## Decision
Topic: Their level
Context: How much to explain.
Options: first time | has shipped
Choice: first time
Date: 2026-11-13
Their sentence:
none
Problem:
none
Reply:
none
Proposal:
none
Reason:
I have not built an API before.
## End

## Decision
Topic: The stack
Context: What has to hold the notes.
Options: keep theirs | take the proposal | mix the two
Choice: mix the two
Date: 2026-11-13
Their sentence:
${sentence}
Problem:
${problem}
Reply:
${reply}
Proposal:
${proposal}
Reason:
I want separate notes, but not accounts on the first day.
## End
`;
    writeFileSync(path.join(project, ".praxis", "decisions.md"), source);
    run("stop", project);
    const decisions = readFileSync(path.join(project, "DECISIONS.md"), "utf8");
    const level = decisions.split(/^## /m)[1] ?? "";
    const stack = decisions.split(/^## /m)[2] ?? "";
    assert.doesNotMatch(level, /Their sentence|Problem:|Reply:|Proposal:/);
    for (const field of [sentence, problem, reply, proposal]) assert.ok(stack.includes(field), field);
  });

  it("exports a decision id and omits one written as none", () => {
    const source = `Goal: Notes API

## Decision
Topic: Where the data lives
Decision ID: storage-001
Context: Where notes are stored.
Options: one file | a database
Choice: one file
Date: 2026-11-14
Reason:
One file is enough.
Prediction:
It writes the note.
## End

## Decision
Topic: Their level
Decision ID: none
Context: How much to explain.
Options: first time | has shipped
Choice: first time
Date: 2026-11-14
Reason:
I have shipped one class project.
## End
`;
    const rendered = renderDecisions(source, templates);
    assert.match(rendered, /\*\*Decision ID:\*\* storage-001/);
    const level = rendered.split("## 2.")[1] ?? "";
    assert.doesNotMatch(level, /Decision ID/);
    assert.equal(parseDecisions(source).decisions[0]?.decisionId, "storage-001");
    assert.equal(parseDecisions(source).decisions[1]?.decisionId, "");
  });

  it("writes a map of existing code before asking a new question", () => {
    const project = tempProject();
    mkdirSync(path.join(project, "src"));
    writeFileSync(path.join(project, "src", "app.ts"), "export const started = true;\n");
    const started = run("session", project);
    const context = (started.parsed as { additional_context?: string }).additional_context ?? "";
    assert.match(context, /turn Praxis on/);
    assert.equal(existsSync(path.join(project, ".praxis", "map.md")), false);
    mkdirSync(path.join(project, "src/a/b/c/d"), { recursive: true });
    writeFileSync(path.join(project, "src/a/b/c/d/leaf.ts"), "export const leaf = true;\n");
    mkdirSync(path.join(project, ".praxis"), { recursive: true });
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Praxis: on\nStatus: pending\nTopic: the floor\nBypass: none\n");
    run("session", project);
    const nested = readFileSync(path.join(project, ".praxis", "map.md"), "utf8");
    assert.match(section(nested, "Unknowns"), /src\/a\/b\/c\/d\/leaf\.ts/);
    const again = run("session", project);
    assert.match((again.parsed as { additional_context?: string }).additional_context ?? "", /before asking a new question/);
    assert.equal(readFileSync(path.join(project, ".praxis", "map.md"), "utf8"), nested);
  });

  it("adds a new file under Unknowns and keeps a description already written", () => {
    const project = tempProject();
    mkdirSync(path.join(project, "src"));
    writeFileSync(path.join(project, "src", "app.ts"), "export const started = true;\n");
    writeFileSync(path.join(project, ".praxis", "map.md"), `# Map

## Parts
- src/app.ts — starts the server

## Unknowns
- who calls the server
`);
    writeFileSync(path.join(project, "src", "db.ts"), "export const db = true;\n");
    run("session", project);
    const map = readFileSync(path.join(project, ".praxis", "map.md"), "utf8");
    assert.match(map, /src\/app\.ts — starts the server/);
    assert.match(map, /who calls the server/);
    assert.match(section(map, "Parts"), /- src\/db\.ts/);
    assert.match(section(map, "Unknowns"), /- src\/db\.ts/);
    assert.doesNotMatch(section(map, "Unknowns"), /- src\/app\.ts\s*$/m);
  });

  it("writes a role hint and still leaves that file unknown", () => {
    const project = tempProject();
    mkdirSync(path.join(project, "src/routes"), { recursive: true });
    mkdirSync(path.join(project, "src/db"), { recursive: true });
    mkdirSync(path.join(project, "tests"));
    writeFileSync(path.join(project, "package.json"), "{\"dependencies\":{\"express\":\"4.0.0\"}}\n");
    writeFileSync(path.join(project, "Dockerfile"), "FROM node:20\n");
    writeFileSync(path.join(project, "src/routes/expenses.ts"), "export const route = true;\n");
    writeFileSync(path.join(project, "src/db/expenses.ts"), "export const rows = true;\n");
    writeFileSync(path.join(project, "tests/expenses.test.ts"), "export const test = true;\n");
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Praxis: on\nStatus: pending\nTopic: the floor\nBypass: none\n");
    run("session", project);
    const map = readFileSync(path.join(project, ".praxis", "map.md"), "utf8");
    assert.match(map, /package\.json — package manager, framework/);
    assert.match(map, /Dockerfile — deployment/);
    assert.match(map, /src\/routes\/expenses\.ts — API boundary/);
    assert.match(map, /src\/db\/expenses\.ts — data access/);
    assert.match(map, /tests\/expenses\.test\.ts — test/);
    assert.match(section(map, "Unknowns"), /Dockerfile — deployment/);
  });

  it("keeps a role file when plain files would fill the map", () => {
    const files = Array.from({ length: 41 }, (_, index) => `src/file-${index}.ts`);
    files.push("Dockerfile");
    const selected = selectMapFiles(files);
    assert.equal(selected.files.includes("Dockerfile"), true);
    assert.equal(selected.files.length, 40);
    assert.equal(selected.truncated, true);
  });

  it("puts a bare part back under Unknowns", () => {
    const map = syncMap("# Map\n\n## Parts\n- src/app.ts\n", ["src/app.ts"]);
    assert.match(section(map, "Unknowns"), /- src\/app\.ts/);
    assert.match(map, /## Parts/);
  });

  it("does not map a repository that has no code, or this plugin", () => {
    const readmeOnly = tempProject();
    writeFileSync(path.join(readmeOnly, "README.md"), "# Notes\n");
    const opened = run("session", readmeOnly);
    const openedContext = (opened.parsed as { additional_context?: string }).additional_context ?? "";
    assert.match(openedContext, /AskQuestion/);
    assert.equal(existsSync(path.join(readmeOnly, ".praxis", "map.md")), false);

    const plugin = tempProject();
    mkdirSync(path.join(plugin, "src"));
    mkdirSync(path.join(plugin, "rules"));
    mkdirSync(path.join(plugin, ".cursor-plugin"));
    writeFileSync(path.join(plugin, "src", "app.ts"), "export const started = true;\n");
    writeFileSync(path.join(plugin, "rules", "praxis.mdc"), "rule\n");
    writeFileSync(path.join(plugin, ".cursor-plugin", "plugin.json"), "{}\n");
    writeFileSync(path.join(plugin, ".praxis", "decisions.md"), notes());
    assert.deepEqual(run("session", plugin).parsed, {});
    assert.equal(existsSync(path.join(plugin, ".praxis", "map.md")), false);
    assert.equal(existsSync(path.join(plugin, "DECISIONS.md")), false);
  });
});

function section(map: string, heading: string): string {
  const match = new RegExp(`^## ${heading}[ \\t]*$`, "m").exec(map);
  if (!match) return "";
  const rest = map.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}
