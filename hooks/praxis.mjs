import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureMap, isPluginProject, writeRecord } from "./record.mjs";
import { protectMarkedEdit, recordPractice } from "./review.mjs";

const EDIT_TOOLS = new Set(["Write", "StrReplace", "Delete", "EditNotebook", "Edit", "ApplyPatch"]);

export function parseProgress(text) {
  const progress = { status: null, topic: "", bypass: "none", praxis: null };
  for (const line of text.split(/\r?\n/)) {
    const status = /^Status:\s*(pending|confirmed|choosing|off)\s*$/i.exec(line);
    if (status) progress.status = status[1].toLowerCase();
    const topic = /^Topic:\s*(.*?)\s*$/.exec(line);
    if (topic) progress.topic = topic[1];
    const bypass = /^Bypass:\s*(none|one-step)\s*$/i.exec(line);
    if (bypass) progress.bypass = bypass[1].toLowerCase();
    const praxis = /^Praxis:\s*(on|off|choosing)\s*$/i.exec(line);
    if (praxis) progress.praxis = praxis[1].toLowerCase();
  }
  return progress;
}

export function projectRoot(input, env = process.env) {
  if (typeof env.CURSOR_PROJECT_DIR === "string" && env.CURSOR_PROJECT_DIR.length > 0) {
    return path.resolve(env.CURSOR_PROJECT_DIR);
  }
  const roots = input.workspace_roots;
  if (Array.isArray(roots) && typeof roots[0] === "string" && roots[0].length > 0) {
    return path.resolve(roots[0]);
  }
  if (typeof input.cwd === "string" && input.cwd.length > 0) return path.resolve(input.cwd);
  return process.cwd();
}

export const CHOICE = `This project has not chosen Praxis yet. Do not ask the student to run a command.

Call AskQuestion once, before any project code and before the floor. One question, two options: turn Praxis on for this project, or leave it off. Do not ask in plain text.

If they choose off, write these lines to .praxis/progress.md and do not ask another question:
Praxis: off
Status: off
Bypass: none

If they choose on, write these lines, then ask the floor one question at a time:
Praxis: on
Status: pending
Topic: the floor
Bypass: none`;

export const OFF = `Praxis is off for this project. Do not ask interview questions. If they ask to turn Praxis on, write Praxis: on and Status: pending in .praxis/progress.md, then ask the floor with AskQuestion, one question at a time. Do not ask them to run a command.`;

export function sessionContext(progress) {
  if (progress.status !== "pending") return "";
  const topic = progress.topic.length > 0 ? progress.topic : "the open question";
  return `Praxis has an open decision: ${topic}. Continue that question in this chat before writing project code. Do not ask the student to run a command. The note is .praxis/progress.md.`;
}

export function openChoice(root, progress) {
  if (isPluginProject(root)) return "";
  if (progress.praxis === "off" || progress.status === "off") return OFF;
  if (progress.praxis === "on" || progress.status === "pending" || progress.status === "confirmed") return "";
  if (progress.status !== "choosing") {
    mkdirSync(path.join(root, ".praxis"), { recursive: true });
    writeFileSync(progressFile(root), "Praxis: choosing\nStatus: choosing\nTopic: Praxis\nBypass: none\n");
  }
  return CHOICE;
}

export function gateEdit(progress, filePath, root) {
  if (progress.praxis === "off" || progress.status === "off") return { permission: "allow" };
  if (progress.status === "choosing") {
    if (isNotesFile(filePath, root)) return { permission: "allow" };
    return {
      permission: "deny",
      user_message: "Choose whether Praxis is on for this project.",
      agent_message: "Call AskQuestion once with two options: turn Praxis on for this project, or leave it off. Do not edit project files until they choose. You may update .praxis/progress.md.",
    };
  }
  if (progress.status !== "pending") return { permission: "allow" };
  if (isNotesFile(filePath, root)) return { permission: "allow" };
  if (progress.bypass === "one-step") return { permission: "allow" };
  const topic = progress.topic.length > 0 ? progress.topic : "the open question";
  return {
    permission: "deny",
    user_message: `Praxis is waiting on an open decision: ${topic}.`,
    agent_message: `Do not edit project files until the student confirms "${topic}". You may update .praxis/progress.md. Set Bypass to one-step only when they asked to do just this step without questions. That bypass covers one step.`,
  };
}

export function clearOneStep(text) {
  return text.replace(/^Bypass:[ \t]*one-step[ \t]*$/gim, "Bypass: none");
}

export function editPath(input) {
  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== "object") return "";
  for (const key of ["path", "file_path", "target_file", "filePath"]) {
    const value = toolInput[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function isNotesFile(filePath, root) {
  if (filePath.length === 0) return false;
  const notes = path.resolve(root, ".praxis");
  const resolved = path.resolve(root, filePath);
  return resolved === notes || resolved.startsWith(notes + path.sep);
}

function progressFile(root) {
  return path.join(root, ".praxis", "progress.md");
}

function readProgress(root) {
  try {
    return readFileSync(progressFile(root), "utf8");
  } catch {
    return "";
  }
}

function respond(command, input) {
  const root = projectRoot(input);
  const text = readProgress(root);
  const progress = parseProgress(text);
  if (command === "session") {
    const mapNote = ensureMap(root);
    writeRecord(root);
    const practiceNote = recordPractice(root);
    const choice = openChoice(root, progress);
    const live = choice === CHOICE ? parseProgress(readProgress(root)) : progress;
    if (choice === OFF) return { additional_context: OFF };
    const context = choice === CHOICE
      ? CHOICE
      : [sessionContext(live), mapNote, practiceNote].filter((part) => part.length > 0).join("\n\n");
    return context.length > 0 ? { additional_context: context } : {};
  }
  if (command === "stop") {
    if (progress.bypass === "one-step") {
      writeFileSync(progressFile(root), clearOneStep(text), "utf8");
    }
    writeRecord(root);
    recordPractice(root);
    return {};
  }
  const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
  if (!EDIT_TOOLS.has(toolName)) return { permission: "allow" };
  const gated = gateEdit(progress, editPath(input), root);
  if (gated.permission === "deny") return gated;
  return protectMarkedEdit(root, input);
}

async function main() {
  const command = process.argv[2] ?? "";
  const raw = await new Promise((resolve) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      body += chunk;
    });
    process.stdin.on("end", () => resolve(body));
  });
  let input = {};
  try {
    input = raw.trim().length > 0 ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const output = command === "gate" || command === "session" || command === "stop"
    ? respond(command, input)
    : {};
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
