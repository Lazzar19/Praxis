import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isSourcePath, listCodeFiles, parseDecisions } from "./record.mjs";

const MARKER = /TODO\(praxis:([^)]+)\)/g;

export function protectMarkedEdit(root, input) {
  const filePath = inputPath(input);
  if (filePath.length === 0 || isNotes(root, filePath) || !isSourcePath(filePath)) return { permission: "allow" };
  const absolute = path.resolve(root, filePath);
  let current = "";
  try {
    current = readFileSync(absolute, "utf8");
  } catch {
    return { permission: "allow" };
  }
  const markers = markersIn(current);
  if (markers.length === 0) return { permission: "allow" };
  const next = nextContents(input, current);
  if (next === null || markers.some((marker) => !next.includes(marker))) {
    const marker = markers[0];
    return {
      permission: "deny",
      user_message: `Praxis left ${marker} for you to write.`,
      agent_message: `The marked function is the student's. Do not remove ${marker} and do not rewrite their function.`,
    };
  }
  return { permission: "allow" };
}

export function recordPractice(root) {
  if (isPluginProject(root)) return "";
  rememberMarks(root);
  return publishReview(root);
}

function rememberMarks(root) {
  const found = scanMarks(root);
  const merged = mergeMarks(readMarks(root), found);
  if (merged.length === 0) return;
  mkdirNotes(root);
  writeFileSync(path.join(root, ".learn-coach", "marks.md"), renderMarks(merged));
}

function publishReview(root) {
  const notes = readNotes(root);
  const decisions = notes.length > 0 ? parseDecisions(notes).decisions : [];
  const verdicts = readVerdicts(root);
  const sections = [];
  const waiting = [];
  for (const mark of readMarks(root)) {
    const decision = decisions.find((item) => item.topic === mark.topic);
    if (!decision) continue;
    let source = "";
    try {
      source = readFileSync(path.resolve(root, mark.file), "utf8");
    } catch {
      continue;
    }
    if (source.includes(`TODO(praxis:${mark.topic})`)) continue;
    if (decision.prediction.length === 0) {
      waiting.push(`The decision "${mark.topic}" has no prediction. Ask for one sentence about what they expect the code to do before reviewing ${mark.functionName}.`);
      continue;
    }
    const verdict = verdicts.get(mark.topic);
    if (!verdict) {
      const name = mark.functionName.length > 0 ? mark.functionName : "the marked function";
      waiting.push(`Review ${name} in ${mark.file} against the decision "${mark.topic}". Quote the choice, the reason, and the prediction. Say whether the result matched their sentence. Record it in .learn-coach/review.md as Matched: yes or Matched: no. Do not rewrite the function.`);
      continue;
    }
    sections.push(renderSection(decision, mark, verdict));
  }
  if (sections.length > 0) {
    mkdirNotes(root);
    writeFileSync(path.join(root, ".learn-coach", "report.md"), `# Review\n\n${sections.join("\n\n")}\n`);
  }
  const published = sections.length > 0
    ? `A review is in .learn-coach/report.md. Tell the student whether the result matched their sentence, and quote the decision and the prediction. Do not rewrite the function.\n\n${sections.join("\n\n")}`
    : "";
  return [published, ...waiting].filter((part) => part.length > 0).join("\n\n");
}

function renderSection(decision, mark, verdict) {
  const name = mark.functionName.length > 0 ? mark.functionName : "the marked function";
  return `## ${decision.topic}
Choice: ${decision.choice}
Reason: ${decision.reason}
Prediction: ${decision.prediction}
Function: ${name} in ${mark.file}
Matched: ${verdict}`;
}

function scanMarks(root) {
  const listed = listCodeFiles(root);
  const found = [];
  for (const file of listed.files) {
    let source = "";
    try {
      source = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(MARKER)) {
      found.push({
        topic: match[1],
        file,
        functionName: functionNameBefore(source, match.index ?? 0),
      });
    }
  }
  return found;
}

function functionNameBefore(source, index) {
  const lines = source.slice(0, index).split(/\r?\n/).slice(-30).reverse();
  for (const line of lines) {
    const match = /(?:function|func|def)\s+([A-Za-z_][\w]*)/.exec(line);
    if (match) return match[1];
  }
  return "";
}

function mergeMarks(previous, found) {
  const byKey = new Map();
  for (const mark of previous) byKey.set(`${mark.topic}\0${mark.file}`, mark);
  for (const mark of found) byKey.set(`${mark.topic}\0${mark.file}`, mark);
  return [...byKey.values()].sort((left, right) => left.topic.localeCompare(right.topic) || left.file.localeCompare(right.file));
}

function readMarks(root) {
  let text = "";
  try {
    text = readFileSync(path.join(root, ".learn-coach", "marks.md"), "utf8");
  } catch {
    return [];
  }
  return text.split(/^## Mark[ \t]*$/m).slice(1).map(parseMark).filter((mark) => mark !== null);
}

function parseMark(block) {
  const body = block.split(/^## End[ \t]*$/m)[0] ?? "";
  const field = (name) => {
    const match = new RegExp(`^${name}:[ \t]*(.*)$`, "m").exec(body);
    return match ? match[1] : "";
  };
  const topic = field("Topic");
  const file = field("File");
  if (topic.length === 0 || file.length === 0) return null;
  return { topic, file, functionName: field("Function") };
}

function renderMarks(marks) {
  const blocks = marks.map((mark) => `## Mark
Topic: ${mark.topic}
File: ${mark.file}
Function: ${mark.functionName}
## End`);
  return `${blocks.join("\n\n")}\n`;
}

function readVerdicts(root) {
  let text = "";
  try {
    text = readFileSync(path.join(root, ".learn-coach", "review.md"), "utf8");
  } catch {
    return new Map();
  }
  const verdicts = new Map();
  for (const block of text.split(/^## Review[ \t]*$/m).slice(1)) {
    const body = block.split(/^## End[ \t]*$/m)[0] ?? "";
    const topic = /^Topic:[ \t]*(.*)$/m.exec(body)?.[1] ?? "";
    const matched = /^Matched:[ \t]*(yes|no)[ \t]*$/im.exec(body)?.[1];
    if (topic.length > 0 && matched) verdicts.set(topic, matched.toLowerCase());
  }
  return verdicts;
}

function readNotes(root) {
  try {
    return readFileSync(path.join(root, ".learn-coach", "decisions.md"), "utf8");
  } catch {
    return "";
  }
}

function markersIn(source) {
  return [...source.matchAll(MARKER)].map((match) => match[0]);
}

function nextContents(input, current) {
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  if (tool === "Delete") return "";
  if (tool === "Write") return firstString(toolInput, ["contents", "content"]);
  if (tool === "StrReplace" || tool === "Edit") {
    const oldString = firstString(toolInput, ["old_string", "old_str"]);
    const newString = firstString(toolInput, ["new_string", "new_str"]);
    if (oldString === null || newString === null) return null;
    if (!current.includes(oldString)) return current;
    return toolInput.replace_all === true ? current.replaceAll(oldString, newString) : current.replace(oldString, newString);
  }
  return null;
}

function firstString(toolInput, keys) {
  for (const key of keys) {
    const value = toolInput[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function inputPath(input) {
  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== "object") return "";
  for (const key of ["path", "file_path", "target_file", "filePath"]) {
    const value = toolInput[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function isNotes(root, filePath) {
  const notes = path.resolve(root, ".learn-coach");
  const resolved = path.resolve(root, filePath);
  return resolved === notes || resolved.startsWith(`${notes}${path.sep}`);
}

function isPluginProject(root) {
  return existsSync(path.join(root, ".cursor-plugin", "plugin.json"))
    && existsSync(path.join(root, "rules", "praxis.mdc"));
}

function mkdirNotes(root) {
  mkdirSync(path.join(root, ".learn-coach"), { recursive: true });
}
