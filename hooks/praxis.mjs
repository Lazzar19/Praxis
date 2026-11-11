import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

Call AskQuestion once, before any project code and before the floor. One question, two options: turn Praxis on for this project, or leave it off. Do not ask in plain text. Do not create .praxis before they answer.

If they choose off, write these lines to .praxis/progress.md and do not ask another question. That write is refused, and .praxis is not kept:
Praxis: off
Status: off
Bypass: none

If they choose on, write these lines, then ask the floor one question at a time. Notes begin with that file:
Praxis: on
Status: pending
Topic: the floor
Bypass: none`;

export const OFF = `Praxis is off for this project. Do not ask interview questions. Do not create .praxis. If they ask to turn Praxis on, write Praxis: on and Status: pending in .praxis/progress.md, then ask the floor with AskQuestion, one question at a time. Do not ask them to run a command.`;

export function sessionContext(progress) {
  if (progress.status !== "pending") return "";
  const topic = progress.topic.length > 0 ? progress.topic : "the open question";
  return `Praxis has an open decision: ${topic}. Continue that question in this chat before writing project code. Do not ask the student to run a command. The note is .praxis/progress.md.`;
}

export function praxisOn(progress) {
  return progress.praxis === "on" || progress.status === "pending" || progress.status === "confirmed";
}

export function gateEdit(progress, filePath, root) {
  if (progress.praxis === "off" || progress.status === "off") return { permission: "allow" };
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

function declinedFile(root) {
  const dir = process.env.PRAXIS_STATE_DIR && process.env.PRAXIS_STATE_DIR.length > 0
    ? process.env.PRAXIS_STATE_DIR
    : path.join(homedir(), ".local", "state", "praxis", "declined");
  const name = createHash("sha256").update(path.resolve(root)).digest("hex");
  return path.join(dir, name);
}

export function isDeclined(root) {
  return existsSync(declinedFile(root));
}

function setDeclined(root) {
  const file = declinedFile(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${path.resolve(root)}\n`);
}

function clearDeclined(root) {
  rmSync(declinedFile(root), { force: true });
}

function hasDecisions(root) {
  try {
    return readFileSync(path.join(root, ".praxis", "decisions.md"), "utf8").includes("## Decision");
  } catch {
    return false;
  }
}

function hasNotes(root) {
  return ["decisions.md", "map.md", "marks.md", "review.md", "report.md"].some((name) => existsSync(path.join(root, ".praxis", name)));
}

function notesActive(root, progress) {
  if (progress.praxis === "off" || progress.status === "off") return false;
  if (praxisOn(progress)) return true;
  if (isDeclined(root)) return false;
  return hasNotes(root);
}

function removeUnusedNotes(root, progress) {
  const notes = path.join(root, ".praxis");
  if (!existsSync(notes)) return;
  const declined = progress.praxis === "off" || progress.status === "off";
  const choosing = progress.praxis === "choosing" || progress.status === "choosing";
  if (declined) setDeclined(root);
  if ((declined || choosing) && !hasDecisions(root)) {
    rmSync(notes, { recursive: true, force: true });
    return;
  }
  if (!praxisOn(progress) && !hasNotes(root)) rmSync(notes, { recursive: true, force: true });
}

function progressAfterEdit(input, root, filePath) {
  if (path.resolve(root, filePath) !== path.resolve(root, ".praxis", "progress.md")) return null;
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  if (tool === "Delete") return "";
  if (tool === "Write") {
    const text = toolInput.contents ?? toolInput.content;
    return typeof text === "string" ? text : null;
  }
  if (tool === "StrReplace" || tool === "Edit") {
    let current = "";
    try {
      current = readFileSync(progressFile(root), "utf8");
    } catch {
      current = "";
    }
    const oldString = toolInput.old_string ?? toolInput.old_str;
    const newString = toolInput.new_string ?? toolInput.new_str;
    if (typeof oldString !== "string" || typeof newString !== "string") return null;
    if (!current.includes(oldString)) return current;
    return toolInput.replace_all === true ? current.replaceAll(oldString, newString) : current.replace(oldString, newString);
  }
  return null;
}

function refusedOff() {
  return {
    permission: "deny",
    user_message: "Praxis is off for this project. No notes are kept.",
    agent_message: "They left Praxis off. Do not create .praxis and do not write notes. If they later ask to turn Praxis on, write .praxis/progress.md with Praxis: on and Status: pending, then ask the floor with AskQuestion, one question at a time.",
  };
}

function gateNotes(input, root, progress, filePath) {
  if (!isNotesFile(filePath, root)) return null;
  const next = progressAfterEdit(input, root, filePath);
  if (next !== null && (parseProgress(next).praxis === "off" || parseProgress(next).status === "off")) {
    setDeclined(root);
    return refusedOff();
  }
  if (next !== null && praxisOn(parseProgress(next))) {
    clearDeclined(root);
    return { permission: "allow" };
  }
  if (!notesActive(root, progress)) {
    return {
      permission: "deny",
      user_message: "Praxis notes start when you turn it on.",
      agent_message: "Do not create .praxis until they choose on. If they choose off, write .praxis/progress.md with Praxis: off and Status: off. That write is refused and nothing is kept.",
    };
  }
  return { permission: "allow" };
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
    if (isPluginProject(root)) return {};
    removeUnusedNotes(root, progress);
    const live = parseProgress(readProgress(root));
    if (praxisOn(live)) clearDeclined(root);
    else if (isDeclined(root) || live.praxis === "off" || live.status === "off") return { additional_context: OFF };
    if (!notesActive(root, live)) return { additional_context: CHOICE };
    const context = [sessionContext(live), ensureMap(root), recordPractice(root)].filter((part) => part.length > 0).join("\n\n");
    writeRecord(root);
    return context.length > 0 ? { additional_context: context } : {};
  }
  if (command === "stop") {
    if (!isPluginProject(root) && notesActive(root, progress)) {
      if (progress.bypass === "one-step") writeFileSync(progressFile(root), clearOneStep(text), "utf8");
      writeRecord(root);
      recordPractice(root);
    }
    return {};
  }
  const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
  if (!EDIT_TOOLS.has(toolName)) return { permission: "allow" };
  const filePath = editPath(input);
  const notes = gateNotes(input, root, progress, filePath);
  if (notes?.permission === "deny") return notes;
  const gated = gateEdit(progress, filePath, root);
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
