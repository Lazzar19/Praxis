import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { CoachError } from "./errors.js";
import { packageRoot } from "./paths.js";
import { readSession, resolveProjectRoot, sessionFile, writeSession } from "./session.js";
import { sessionTracking, type Session } from "./types.js";

const directories: string[] = [];

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "learn-coach-"));
  directories.push(directory);
  return directory;
}

const session: Session = {
  version: 1,
  goal: "Notes API",
  levels: {
    stack: "beginner",
    database: "intermediate",
    api: "intermediate",
    auth: "advanced",
    deploy: "beginner",
  },
  handsOn: "todos",
  answers: [],
  startedAt: "2026-11-04T15:00:00.000Z",
  exportedAt: null,
  ...sessionTracking(),
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("session store", () => {
  it("round-trips the session json in the student project", () => {
    const project = tempProject();
    writeSession(project, session);
    assert.deepEqual(readSession(project), session);
    assert.equal(sessionFile(project), path.join(project, ".learn-coach", "session.json"));
  });

  it("returns null when the project has no session", () => {
    assert.equal(readSession(tempProject()), null);
  });

  it("refuses the coach repository and a missing directory", () => {
    assert.throws(() => resolveProjectRoot(packageRoot()), /student project/);
    assert.throws(() => resolveProjectRoot(path.join(tmpdir(), "learn-coach-missing-project")), CoachError);
  });

  it("refuses a session file that is not json", () => {
    const project = tempProject();
    const file = sessionFile(project);
    writeSession(project, session);
    writeFileSync(file, "{", "utf8");
    assert.throws(() => readSession(project), /not valid JSON/);
  });
});
