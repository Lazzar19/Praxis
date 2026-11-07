import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { createCoachServer } from "./server.js";

const directories: string[] = [];
const clock = () => new Date("2026-11-04T15:00:00.000Z");
const reason = "SQLite is one file, and {{goal}} does not need a second service.";

function tempProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "learn-coach-"));
  directories.push(directory);
  return directory;
}

function text(result: CallToolResult): string {
  const block = result.content[0];
  assert.ok(block && block.type === "text");
  return block.text;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("MCP session loop", () => {
  it("runs from the first question through export", async () => {
    const project = tempProject();
    const server = createCoachServer({ clock });
    const client = new Client({ name: "learn-coach-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const started = await client.callTool({
        name: "start_session",
        arguments: { projectRoot: project, goal: "Notes API", levels: { database: "beginner" } },
      });
      assert.equal(started.isError, undefined);
      assert.match(text(started), /Started a session/);

      const question = await client.callTool({
        name: "next_question",
        arguments: { projectRoot: project },
      });
      assert.match(text(question), /Question 1 of 5/);
      assert.equal(question.structuredContent && typeof question.structuredContent === "object"
        ? (question.structuredContent as { question?: { id?: string } }).question?.id
        : undefined, "stack");

      const rejected = await client.callTool({
        name: "record_answer",
        arguments: { projectRoot: project, questionId: "stack", optionId: "node", reason: " " },
      });
      assert.equal(rejected.isError, true);
      assert.match(text(rejected), /reason is required/);

      const answers = [
        { questionId: "stack", optionId: "node", reason: "I already debug JavaScript." },
        { questionId: "database", optionId: "sqlite", reason },
        { questionId: "api", optionId: "rest", reason: "One client, a few URLs." },
        { questionId: "auth", optionId: "sessions", reason: "I want to learn the cookie." },
        { questionId: "deploy", optionId: "managed", reason: "Classmates need a URL." },
      ];
      for (const answer of answers) {
        const recorded = await client.callTool({
          name: "record_answer",
          arguments: { projectRoot: project, ...answer },
        });
        assert.notEqual(recorded.isError, true);
        assert.ok(text(recorded).includes(answer.reason));
      }

      const exported = await client.callTool({
        name: "export_decisions",
        arguments: { projectRoot: project },
      });
      assert.notEqual(exported.isError, true);
      const decisions = readFileSync(path.join(project, "DECISIONS.md"), "utf8");
      const plan = readFileSync(path.join(project, "PLAN.md"), "utf8");
      const stored = readFileSync(path.join(project, ".learn-coach", "session.json"), "utf8");
      assert.ok(decisions.includes(reason));
      assert.ok(plan.includes(reason));
      assert.ok(stored.includes(reason));
    } finally {
      await client.close();
      await server.close();
    }
  });
});
