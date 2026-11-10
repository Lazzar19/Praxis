import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureMap, isPluginProject, writeRecord } from "./record.mjs";
import { protectMarkedEdit, recordPractice } from "./review.mjs";

const EDIT_TOOLS = new Set(["Write", "StrReplace", "Delete", "EditNotebook", "Edit", "ApplyPatch"]);

export function parseProgress(text) {
  const progress = { status: null, topic: "", bypass: "none" };
  for (const line of text.split(/\r?\n/)) {
    const status = /^Status:\s*(pending|confirmed)\s*$/i.exec(line);
    if (status) progress.status = status[1].toLowerCase();
    const topic = /^Topic:\s*(.*?)\s*$/.exec(line);
    if (topic) progress.topic = topic[1];
    const bypass = /^Bypass:\s*(none|one-step)\s*$/i.exec(line);
    if (bypass) progress.bypass = bypass[1].toLowerCase();
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

export const FIRST_REPLY = `Praxis is on. Do not ask the student to run a command.

The first reply to a request to build a product, add a feature, or change how it works asks every floor topic before any project code. Ask them in that same reply, each as its own question. For each one, explain what the decision changes in this project, then each option: what it is, when someone would choose it, and what they give up. A recommendation is only a suggestion. One answer does not close two topics.

1. Their level for the work in front of them.
2. The stack.
3. Where the data lives.
4. Who may see or change it.
5. How it ships.

Also ask about a decision their prompt opens that those five do not cover. Skip the floor only when they name a small edit: explain this code, rename, format, or fix a typo. When they say to do just this step without questions, set Bypass to one-step and do that step only.`;

export function sessionContext(progress) {
  if (progress.status !== "pending") return "";
  const topic = progress.topic.length > 0 ? progress.topic : "the open question";
  return `Praxis has an open decision: ${topic}. Continue that question in this chat before writing project code. Do not ask the student to run a command. The note is .learn-coach/progress.md.`;
}

export function openFloor(root, progress) {
  if (isPluginProject(root) || progress.status === "pending" || progress.status === "confirmed") return "";
  mkdirSync(path.join(root, ".learn-coach"), { recursive: true });
  writeFileSync(progressFile(root), "Status: pending\nTopic: the floor\nBypass: none\n");
  return FIRST_REPLY;
}

export function gateEdit(progress, filePath, root) {
  if (progress.status !== "pending") return { permission: "allow" };
  if (isNotesFile(filePath, root)) return { permission: "allow" };
  if (progress.bypass === "one-step") return { permission: "allow" };
  const topic = progress.topic.length > 0 ? progress.topic : "the open question";
  return {
    permission: "deny",
    user_message: `Praxis is waiting on an open decision: ${topic}.`,
    agent_message: `Do not edit project files until the student confirms "${topic}". You may update .learn-coach/progress.md. Set Bypass to one-step only when they asked to do just this step without questions. That bypass covers one step.`,
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
  const notes = path.resolve(root, ".learn-coach");
  const resolved = path.resolve(root, filePath);
  return resolved === notes || resolved.startsWith(notes + path.sep);
}

function progressFile(root) {
  return path.join(root, ".learn-coach", "progress.md");
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
    const floor = openFloor(root, progress);
    const live = floor.length > 0 ? parseProgress(readProgress(root)) : progress;
    const context = [floor, sessionContext(live), mapNote, practiceNote].filter((part) => part.length > 0).join("\n\n");
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
