import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sessionProblems } from "./consistency.mjs";
import { classifyPath, ensureMap, isPluginProject, writeRecord } from "./record.mjs";
import { syncState } from "./state.mjs";
import { protectMarkedEdit, recordPractice } from "./review.mjs";

const EDIT_TOOLS = new Set(["Write", "StrReplace", "Delete", "EditNotebook", "Edit", "ApplyPatch"]);

const BYPASS_SCOPES = "none|one-step|one-edit|one-file|one-build-step|documentation-only|test-only";

export function parseProgress(text) {
  const progress = { status: null, topic: "", bypass: "none", praxis: null, file: "", decisionId: "" };
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const status = /^Status:\s*(pending|confirmed|choosing|off)\s*$/i.exec(line);
    if (status) progress.status = status[1].toLowerCase();
    const topic = /^Topic:\s*(.*?)\s*$/.exec(line);
    if (topic) progress.topic = topic[1];
    const bypass = new RegExp(`^Bypass:\\s*(${BYPASS_SCOPES})\\s*$`, "i").exec(line);
    if (bypass) progress.bypass = bypass[1].toLowerCase();
    if (/^Bypass:\s*$/i.test(line)) {
      for (let nested = index + 1; nested < lines.length; nested += 1) {
        const field = /^[ \t]+(scope|expires|reason|file):\s*(.*?)\s*$/i.exec(lines[nested]);
        if (!field) break;
        if (field[1].toLowerCase() === "scope") progress.bypass = field[2].toLowerCase();
        if (field[1].toLowerCase() === "file") progress.file = field[2];
      }
    }
    const decisionId = /^Decision ID:\s*(.*?)\s*$/.exec(line);
    if (decisionId) progress.decisionId = decisionId[1];
    const file = /^File:\s*(.*?)\s*$/.exec(line);
    if (file) progress.file = file[1];
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

Call AskQuestion once, before any project code and before the debate. One question, two options: turn Praxis on for this project, or leave it off. Do not ask in plain text. Do not create .praxis before they answer.

If they choose off, write these lines to .praxis/progress.md and do not ask another question. That write is refused, and .praxis is not kept:
Praxis: off
Status: off
Bypass: none

If they choose on, write these lines, then take their sentence before offering options. Notes begin with that file:
Praxis: on
Status: pending
Topic: their sentence
Bypass: none`;

export const OFF = `Praxis is off for this project. Do not ask interview questions. Do not create .praxis. If they ask to turn Praxis on, write Praxis: on and Status: pending in .praxis/progress.md, then take their sentence before offering options. Do not ask them to run a command.`;

export function sessionContext(progress) {
  if (progress.status !== "pending") return "";
  const topic = progress.topic.length > 0 ? progress.topic : "their sentence";
  const note = "Do not ask the student to run a command. The note is .praxis/progress.md.";
  if (/problem/i.test(topic)) {
    return `Praxis has an open problem: ${topic}. Continue that problem before any option list. ${note}`;
  }
  if (/proposal/i.test(topic)) {
    return `Praxis has an open proposal: ${topic}. Put that proposal beside their sentence, then ask them to keep theirs, take the proposal, or mix the two. ${note}`;
  }
  return `Praxis is waiting on ${topic}. Take their sentence before offering options. ${note}`;
}

export function praxisOn(progress) {
  return progress.praxis === "on" || progress.status === "pending" || progress.status === "confirmed";
}

export function gateEdit(progress, filePath, root) {
  if (progress.praxis === "off" || progress.status === "off") return { permission: "allow" };
  if (progress.status !== "pending") return { permission: "allow" };
  if (isNotesFile(filePath, root)) return { permission: "allow" };
  const scoped = bypassDecision(progress, filePath, root);
  if (scoped === "allow") return { permission: "allow" };
  if (scoped === "file") {
    return {
      permission: "deny",
      user_message: `Praxis is allowing edits only in ${progress.file}.`,
      agent_message: `This bypass is one-file. Edit only ${progress.file}.`,
    };
  }
  if (scoped === "docs") {
    return {
      permission: "deny",
      user_message: "This bypass allows documentation edits only.",
      agent_message: "This bypass is documentation-only. Edit markdown or text docs, not source.",
    };
  }
  if (scoped === "tests") {
    return {
      permission: "deny",
      user_message: "This bypass allows test edits only.",
      agent_message: "This bypass is test-only. Edit a test file, not application source.",
    };
  }
  const topic = progress.topic.length > 0 ? progress.topic : "the open question";
  return {
    permission: "deny",
    user_message: `Praxis is waiting on an open decision: ${topic}.`,
    agent_message: `Do not edit project files until the student confirms "${topic}". You may update .praxis/progress.md. Set Bypass to one-step only when they asked to do just this step without questions. That bypass covers one step.`,
  };
}

function bypassDecision(progress, filePath, root) {
  const scope = progress.bypass === "one-step" ? "one-build-step" : progress.bypass;
  if (scope === "one-build-step" || scope === "one-edit") return "allow";
  if (scope === "one-file") {
    return progress.file.length === 0 || samePath(root, progress.file, filePath) ? "allow" : "file";
  }
  if (scope === "documentation-only") return isDocumentation(filePath) ? "allow" : "docs";
  if (scope === "test-only") return classifyPath(filePath) === "test" ? "allow" : "tests";
  return "deny";
}

function relativeEdit(root, filePath) {
  const relative = path.relative(root, path.resolve(root, filePath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return filePath.split(path.sep).join("/");
  return relative.split(path.sep).join("/");
}

function samePath(root, left, right) {
  if (left.length === 0 || right.length === 0) return false;
  return path.resolve(root, left) === path.resolve(root, right);
}

function isDocumentation(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".md" || ext === ".mdc" || ext === ".txt" || ext === ".rst" || ext === ".adoc";
}

export function clearOneStep(text) {
  return text.replace(/^Bypass:[ \t]*one-step[ \t]*$/gim, "Bypass: none");
}

export function clearBypass(text) {
  const inline = text.replace(new RegExp(`^Bypass:[ \\t]*(${BYPASS_SCOPES.replace("none|", "")})[ \\t]*$`, "gim"), "Bypass: none");
  const block = inline.replace(/^Bypass:[ \t]*\r?\n(?:[ \t]+(?:scope|expires|reason|file):[^\n]*\r?\n)*/gim, "Bypass: none\n");
  return block.replace(/^File:[ \t]*.*(?:\r?\n)?/gim, "");
}

export function rememberFile(text, filePath) {
  if (/^File:[ \t]/m.test(text)) return text;
  return `${text.replace(/\s*$/, "")}\nFile: ${filePath.split(path.sep).join("/")}\n`;
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
    agent_message: "They left Praxis off. Do not create .praxis and do not write notes. If they later ask to turn Praxis on, write .praxis/progress.md with Praxis: on and Status: pending, then take their sentence before offering options.",
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
    const stateWarning = syncState(root, live);
    const context = [sessionContext(live), ensureMap(root), recordPractice(root), stateWarning, sessionProblems(root, live)].filter((part) => part.length > 0).join("\n\n");
    writeRecord(root);
    return context.length > 0 ? { additional_context: context } : {};
  }
  if (command === "stop") {
    if (!isPluginProject(root) && notesActive(root, progress)) {
      if (progress.bypass !== "none") writeFileSync(progressFile(root), clearBypass(text), "utf8");
      syncState(root, parseProgress(readProgress(root)));
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
  if (!isNotesFile(filePath, root) && filePath.length > 0) {
    if (progress.bypass === "one-edit") writeFileSync(progressFile(root), clearBypass(text), "utf8");
    else if (progress.bypass === "one-file" && progress.file.length === 0) {
      writeFileSync(progressFile(root), rememberFile(text, relativeEdit(root, filePath)), "utf8");
    }
  }
  const guarded = protectMarkedEdit(root, input);
  if (existsSync(path.join(root, ".praxis"))) syncState(root, parseProgress(readProgress(root)));
  return guarded;
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
