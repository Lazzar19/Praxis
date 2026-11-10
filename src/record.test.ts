import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { parseDecisions, renderDecisions, syncMap } from "../hooks/record.mjs";

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
    assert.match(section(map, "Unknowns"), /src\/app\.ts/);
    mkdirSync(path.join(project, "src/a/b/c/d"), { recursive: true });
    writeFileSync(path.join(project, "src/a/b/c/d/leaf.ts"), "export const leaf = true;\n");
    run("session", project);
    const nested = readFileSync(path.join(project, ".learn-coach", "map.md"), "utf8");
    assert.match(section(nested, "Unknowns"), /src\/a\/b\/c\/d\/leaf\.ts/);
    const again = run("session", project);
    assert.match((again.parsed as { additional_context?: string }).additional_context ?? "", /before asking a new question/);
    assert.equal(readFileSync(path.join(project, ".learn-coach", "map.md"), "utf8"), nested);
  });

  it("adds a new file under Unknowns and keeps a description already written", () => {
    const project = tempProject();
    mkdirSync(path.join(project, "src"));
    writeFileSync(path.join(project, "src", "app.ts"), "export const started = true;\n");
    writeFileSync(path.join(project, ".learn-coach", "map.md"), `# Map

## Parts
- src/app.ts — starts the server

## Unknowns
- who calls the server
`);
    writeFileSync(path.join(project, "src", "db.ts"), "export const db = true;\n");
    run("session", project);
    const map = readFileSync(path.join(project, ".learn-coach", "map.md"), "utf8");
    assert.match(map, /src\/app\.ts — starts the server/);
    assert.match(map, /who calls the server/);
    assert.match(section(map, "Parts"), /- src\/db\.ts/);
    assert.match(section(map, "Unknowns"), /- src\/db\.ts/);
    assert.doesNotMatch(section(map, "Unknowns"), /- src\/app\.ts\s*$/m);
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
    assert.equal(existsSync(path.join(readmeOnly, ".learn-coach", "map.md")), false);

    const plugin = tempProject();
    mkdirSync(path.join(plugin, "src"));
    mkdirSync(path.join(plugin, "rules"));
    mkdirSync(path.join(plugin, ".cursor-plugin"));
    writeFileSync(path.join(plugin, "src", "app.ts"), "export const started = true;\n");
    writeFileSync(path.join(plugin, "rules", "praxis.mdc"), "rule\n");
    writeFileSync(path.join(plugin, ".cursor-plugin", "plugin.json"), "{}\n");
    writeFileSync(path.join(plugin, ".learn-coach", "decisions.md"), notes());
    assert.deepEqual(run("session", plugin).parsed, {});
    assert.equal(existsSync(path.join(plugin, ".learn-coach", "map.md")), false);
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
