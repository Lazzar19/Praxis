import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const directories: string[] = [];
const hook = path.resolve("hooks/praxis.mjs");
const reason = "SQLite stays on the laptop";

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "praxis-stop-"));
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

describe("stop praxis", () => {
  it("keeps decision notes when Praxis is turned off, and still refuses the first off", () => {
    const fresh = tempProject();
    const firstOff = run("gate", fresh, {
      tool_name: "Write",
      tool_input: { path: ".praxis/progress.md", contents: "Praxis: off\nStatus: off\nBypass: none\n" },
    });
    assert.equal(firstOff.permission, "deny");

    const project = tempProject();
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Praxis: on\nStatus: pending\nTopic: their sentence\nBypass: none\n");
    writeFileSync(path.join(project, ".praxis", "decisions.md"), `## Decision
Topic: Where the data lives
Choice: take the proposal
Reason:
${reason}
## End
`);
    const stopped = run("gate", project, {
      tool_name: "Write",
      tool_input: { path: ".praxis/progress.md", contents: "Praxis: off\nStatus: off\nBypass: none\n" },
    });
    assert.equal(stopped.permission, "allow");
    writeFileSync(path.join(project, ".praxis", "progress.md"), "Praxis: off\nStatus: off\nBypass: none\n");
    const quiet = run("session", project);
    assert.match(quiet.additional_context ?? "", /Praxis is off for this project/);
    assert.match(quiet.additional_context ?? "", /leave those files in place/);
    assert.match(readFileSync(path.join(project, ".praxis", "decisions.md"), "utf8"), new RegExp(reason));
    const edit = run("gate", project, { tool_name: "Write", tool_input: { path: "src/app.ts", contents: "export const app = true;\n" } });
    assert.equal(edit.permission, "allow");

    const bare = tempProject();
    writeFileSync(path.join(bare, ".praxis", "progress.md"), "Praxis: on\nStatus: pending\nTopic: their sentence\nBypass: none\n");
    const bareStop = run("gate", bare, {
      tool_name: "Write",
      tool_input: { path: ".praxis/progress.md", contents: "Praxis: off\nStatus: off\nBypass: none\n" },
    });
    assert.equal(bareStop.permission, "allow");
    writeFileSync(path.join(bare, ".praxis", "progress.md"), "Praxis: off\nStatus: off\nBypass: none\n");
    run("session", bare);
    assert.equal(existsSync(path.join(bare, ".praxis")), false);
    assert.match(readFileSync(new URL("../commands/stop-praxis.md", import.meta.url), "utf8"), /Do not delete `decisions\.md`/);
  });
});
