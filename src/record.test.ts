import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { parseDecisions, renderDecisions } from "../hooks/record.mjs";

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
  mkdirSync(path.join(directory, ".learn-coach"));
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
    writeFileSync(path.join(project, ".learn-coach", "decisions.md"), source);
    const rendered = renderDecisions(source, templates);
    for (const reason of reasons) assert.ok(rendered.includes(reason), reason);
    assert.equal(parseDecisions(source).decisions.map((decision) => decision.reason).join("\n"), reasons.join("\n"));
    run("stop", project);
    const decisions = readFileSync(path.join(project, "DECISIONS.md"), "utf8");
    assert.equal(decisions.match(/^## /gm)?.length, 5);
    for (const reason of reasons) assert.ok(decisions.includes(reason), reason);
    assert.match(decisions, /Project goal: Notes API/);
    assert.match(decisions, /## 1\. Their level/);
    assert.match(decisions, /## 5\. How it ships/);
  });

  it("writes a map of existing code before asking a new question", () => {
    const project = tempProject();
    mkdirSync(path.join(project, "src"));
    writeFileSync(path.join(project, "src", "app.ts"), "export const started = true;\n");
    const started = run("session", project);
    const context = (started.parsed as { additional_context?: string }).additional_context ?? "";
    assert.match(context, /before asking a new question/);
    const map = readFileSync(path.join(project, ".learn-coach", "map.md"), "utf8");
    assert.match(map, /src\/app\.ts/);
    assert.match(map, /## Unknowns/);
  });
});
