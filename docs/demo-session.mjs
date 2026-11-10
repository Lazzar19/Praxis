#!/usr/bin/env node
/**
 * Reproducible Praxis hook demo for an expense-tracker student project.
 * Run from the plugin repository root: node docs/demo-session.mjs
 * Optional: DEMO_CAPTURE=1 node docs/demo-session.mjs > demo-run.txt
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(REPO_ROOT, "hooks", "praxis.mjs");
const TOPIC = "Where the data lives";
const MARKER = `TODO(praxis:${TOPIC})`;

function fail(message) {
  console.error(`demo-session: ${message}`);
  process.exit(1);
}

function runHook(command, project, input) {
  const result = spawnSync(process.execPath, [HOOK, command], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: project },
  });
  if (result.status !== 0) {
    fail(`${command} exited ${result.status}: ${result.stderr}`);
  }
  const stdout = result.stdout.trim();
  if (stdout.length === 0) return {};
  try {
    return JSON.parse(stdout);
  } catch {
    fail(`${command} stdout was not JSON: ${stdout.slice(0, 200)}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===\n`);
}

function trimBlock(text, maxLines = 24) {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text.trimEnd();
  const head = lines.slice(0, 12).join("\n");
  const tail = lines.slice(-6).join("\n");
  return `${head}\n...\n${tail}`;
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${label}: expected ${e}, got ${a}`);
}

const project = mkdtempSync(path.join(tmpdir(), "praxis-demo-expense-"));
const cleanup = () => {
  try {
    rmSync(project, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
};

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

try {
  mkdirSync(path.join(project, ".praxis"), { recursive: true });
  mkdirSync(path.join(project, "src"), { recursive: true });
  writeFileSync(
    path.join(project, "src", "db.ts"),
    "export const placeholder = true;\n",
  );

  console.log(`Student project: ${project}`);
  console.log(`Hook binary: ${HOOK}`);

  section("1 session (new chat → on or off, then a map on disk)");
  const session1 = runHook("session", project, { cwd: project });
  const ctx1 = session1.additional_context ?? "";
  if (!ctx1.includes("AskQuestion")) fail("session missing AskQuestion guidance");
  if (!ctx1.includes("turn Praxis on")) fail("session missing the on/off choice");
  if (!ctx1.includes("leave it off")) fail("session missing the off option");
  console.log("stdout JSON keys:", Object.keys(session1).join(", "));
  console.log(trimBlock(ctx1));
  if (!existsSync(path.join(project, ".praxis", "map.md"))) {
    fail("map.md was not written");
  }
  if (!existsSync(path.join(project, ".praxis", "progress.md"))) {
    fail("progress.md was not written for floor");
  }

  section("2 gate Write (Status: choosing → deny project file)");
  const denied = runHook("gate", project, {
    tool_name: "Write",
    tool_input: {
      path: "src/app.ts",
      contents: "export const started = true;\n",
    },
    cwd: project,
  });
  if (denied.permission !== "deny") fail("expected deny on pending Write");
  console.log(JSON.stringify(denied, null, 2));

  section("3 Model appends decision + sets confirmed (simulated)");
  const reason =
    "I want SQL queries and it works offline for the family budget.";
  const prediction = "saves a new expense and returns its generated id";
  const decisionsBody = `Goal: Family expense tracker

## Decision
Topic: ${TOPIC}
Context: Where family expenses are stored and queried.
Options: SQLite file | JSON file on disk | Hosted database
Choice: SQLite file
Date: 2026-11-10
Reason:
${reason}
Prediction:
${prediction}
## End
`;
  writeFileSync(path.join(project, ".praxis", "decisions.md"), decisionsBody);
  writeFileSync(
    path.join(project, ".praxis", "progress.md"),
    `Status: confirmed\nTopic: ${TOPIC}\nBypass: none\n`,
  );
  writeFileSync(
    path.join(project, "src", "expenses.ts"),
    `export function saveExpense(): number {
  throw new Error("${MARKER}");
}
`,
  );
  console.log("Wrote .praxis/decisions.md block and src/expenses.ts stub");
  console.log(trimBlock(decisionsBody, 20));

  section("4 stop (export DECISIONS.md + scan marks)");
  runHook("stop", project, {});
  if (!existsSync(path.join(project, "DECISIONS.md"))) fail("DECISIONS.md missing");
  const decisionsMd = readFileSync(path.join(project, "DECISIONS.md"), "utf8");
  if (!decisionsMd.includes(reason)) fail("DECISIONS.md missing reason");
  if (!decisionsMd.includes(prediction)) fail("DECISIONS.md missing prediction");
  console.log(trimBlock(decisionsMd));
  if (!existsSync(path.join(project, ".praxis", "marks.md"))) {
    fail("marks.md missing after stop");
  }
  console.log("\n.praxis/marks.md:");
  console.log(trimBlock(readFileSync(path.join(project, ".praxis", "marks.md"), "utf8"), 16));

  section("5 gate StrReplace (agent removes marker → deny)");
  const denyMark = runHook("gate", project, {
    tool_name: "StrReplace",
    tool_input: {
      path: "src/expenses.ts",
      old_string: `  throw new Error("${MARKER}");`,
      new_string: '  return 42;',
    },
    cwd: project,
  });
  if (denyMark.permission !== "deny") fail("expected deny when marker removed");
  console.log(JSON.stringify(denyMark, null, 2));

  section("6 Student implements (file on disk, then stop)");
  writeFileSync(
    path.join(project, "src", "expenses.ts"),
    `export function saveExpense(): number {
  return 42;
}
`,
  );
  writeFileSync(
    path.join(project, ".praxis", "review.md"),
    `## Review
Topic: ${TOPIC}
Matched: yes
## End
`,
  );
  runHook("stop", project, {});

  if (!existsSync(path.join(project, ".praxis", "report.md"))) {
    fail("report.md missing after review");
  }
  const report = readFileSync(path.join(project, ".praxis", "report.md"), "utf8");
  if (!report.includes("Matched: yes")) fail("report missing verdict");
  if (!report.includes(prediction)) fail("report missing prediction");
  console.log(trimBlock(report));

  section("7 Files produced");
  const rel = (p) => path.relative(project, p).split(path.sep).join("/");
  for (const f of [
    ".praxis/progress.md",
    ".praxis/decisions.md",
    ".praxis/map.md",
    ".praxis/marks.md",
    ".praxis/review.md",
    ".praxis/report.md",
    "DECISIONS.md",
    "src/expenses.ts",
  ]) {
    const abs = path.join(project, f);
    console.log(`${existsSync(abs) ? "✓" : "✗"} ${rel(abs)}`);
    if (!existsSync(abs)) fail(`missing ${f}`);
  }

  section("Done");
  console.log("All hook steps matched expectations.");
} catch (error) {
  cleanup();
  throw error;
}
