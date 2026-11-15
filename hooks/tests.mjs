import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifyPath, isPluginProject, listCodeFiles } from "./record.mjs";

const LIMIT_MS = 15000;
const FILE_LIMIT = 3;

export function runMarkedTests(root, progress) {
  if (isPluginProject(root) || progress.tests === "off") return "";
  if (progress.tests === "done") return readText(path.join(root, ".praxis", "tests.md"));
  if (progress.tests !== "run") return "";
  const files = relevantTests(root);
  const note = files.length === 0
    ? "Tests:\n- 0 passed\n- 0 failed\nNo test file names the marked function. The marked function was not changed."
    : formatRun(execute(root, files));
  writeFileSync(path.join(root, ".praxis", "tests.md"), `${note}\n`);
  const progressFile = path.join(root, ".praxis", "progress.md");
  const text = readText(progressFile);
  const next = text.replace(/^Tests:[ \t]*run[ \t]*$/gim, "Tests: done");
  if (next !== text) writeFileSync(progressFile, next);
  return note;
}

function relevantTests(root) {
  const wanted = targets(root);
  if (wanted.length === 0) return [];
  const found = [];
  for (const file of listCodeFiles(root).files) {
    if (classifyPath(file) !== "test" || found.length >= FILE_LIMIT) continue;
    const source = readText(path.join(root, file));
    if (wanted.some((name) => source.includes(name))) found.push(file);
  }
  return found;
}

function targets(root) {
  const names = [];
  for (const block of readText(path.join(root, ".praxis", "marks.md")).split(/^## Mark[ \t]*$/m).slice(1)) {
    const topic = /^Topic:[ \t]*(.*)$/m.exec(block)?.[1] ?? "";
    const functionName = /^Function:[ \t]*(.*)$/m.exec(block)?.[1] ?? "";
    if (functionName.length > 1) names.push(functionName);
    if (topic.length > 1) names.push(topic);
  }
  return names;
}

function execute(root, files) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_CHANNEL_FD;
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: root,
    encoding: "utf8",
    timeout: LIMIT_MS,
    env,
  });
  if (result.error && result.error.code === "ETIMEDOUT") {
    return { passed: 0, failed: 0, timedOut: true };
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const passed = count(output, "pass");
  const failed = count(output, "fail");
  if (passed + failed > 0) return { passed, failed, timedOut: false };
  return {
    passed: marks(output, /(?:^|\n)\s*[✔✓]/g),
    failed: marks(output, /(?:^|\n)\s*[✖✗×]/g),
    timedOut: false,
  };
}

function count(output, label) {
  const match = new RegExp(`(?:#|\u2139)\\s+${label}\\s+(\\d+)`).exec(output);
  return match ? Number(match[1]) : 0;
}

function marks(output, pattern) {
  return output.match(pattern)?.length ?? 0;
}

function formatRun(result) {
  const timeout = result.timedOut ? "\nThe test run stopped at the time limit." : "";
  return `Tests:\n- ${result.passed} passed\n- ${result.failed} failed${timeout}\nThe marked function was not changed.`;
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
