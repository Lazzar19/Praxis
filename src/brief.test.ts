import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-brief-"));
  directories.push(directory);
  mkdirSync(path.join(directory, ".praxis"), { recursive: true });
  return directory;
}

function run(command: string, project: string, input: unknown = {}): { additional_context?: string; permission?: string } {
  const result = spawnSync(process.execPath, [hook, command], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: project, PRAXIS_STATE_DIR: path.join(project, ".praxis-state") },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { additional_context?: string; permission?: string };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("late start", () => {
  it("names the goal and the architecture already in the tree, and stays quiet without them", () => {
    const quiet = tempProject();
    writeFileSync(path.join(quiet, ".praxis", "progress.md"), "Praxis: off\nStatus: off\nBypass: none\n");
    const off = run("session", quiet);
    assert.match(off.additional_context ?? "", /start-praxis/);
    assert.doesNotMatch(off.additional_context ?? "", /Already in the tree/);

    const project = tempProject();
    writeFileSync(path.join(project, "README.md"), "# Family expense tracker\n\nA budget for one household.\n");
    writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "expenses", dependencies: { express: "4.0.0" } }));
    mkdirSync(path.join(project, "src", "db"), { recursive: true });
    mkdirSync(path.join(project, "src", "routes"), { recursive: true });
    writeFileSync(path.join(project, "src", "db", "expenses.ts"), "export const db = true;\n");
    writeFileSync(path.join(project, "src", "routes", "expenses.ts"), "export const route = true;\n");
    writeFileSync(path.join(project, "render.yaml"), "services: []\n");
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Praxis: off\nStatus: off\nBypass: none\n");
    run("session", project);
    const turnedOn = run("gate", project, {
      tool_name: "Write",
      tool_input: {
        path: ".praxis/progress.md",
        contents: "Praxis: on\nStatus: pending\nTopic: their sentence\nBypass: none\n",
      },
    });
    assert.equal(turnedOn.permission, "allow");
    mkdirSync(path.join(project, ".praxis"), { recursive: true });
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Praxis: on\nStatus: pending\nTopic: their sentence\nBypass: none\n");
    const started = run("session", project);
    const context = started.additional_context ?? "";
    assert.match(context, /Goal: Family expense tracker/);
    assert.match(context, /data access: src\/db\/expenses\.ts/);
    assert.match(context, /API boundary: src\/routes\/expenses\.ts/);
    assert.match(context, /deployment: render\.yaml/);
    assert.match(context, /framework: express/);
    assert.match(context, /It is not their sentence and it is not a decision/);
    assert.match(readFileSync(new URL("../commands/start-praxis.md", import.meta.url), "utf8"), /Praxis: on/);

    writeFileSync(path.join(project, ".praxis", "decisions.md"), `## Decision
Topic: Where the data lives
Choice: one file
Reason:
The laptop is enough
## End
`);
    const again = run("session", project);
    assert.doesNotMatch(again.additional_context ?? "", /Already in the tree/);
  });
});
