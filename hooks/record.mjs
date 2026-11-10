import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".rs", ".rb", ".php", ".cs", ".cpp", ".c", ".h", ".swift", ".kt",
]);

export const MAP_NOTE = "A map of the existing code is in .praxis/map.md. Mark anything you could not see under Unknowns before asking a new question.";

export function isSourcePath(filePath) {
  return SOURCE_EXT.has(path.extname(filePath).toLowerCase());
}

export function parseDecisions(text) {
  const goalMatch = /^Goal:\s*(.*)$/m.exec(text);
  const blocks = text.split(/^## Decision[ \t]*$/m).slice(1);
  return {
    goal: goalMatch ? goalMatch[1] : "",
    decisions: blocks.map(parseBlock).filter((decision) => decision !== null),
  };
}

export function renderDecisions(notes, templates) {
  const parsed = parseDecisions(notes);
  const entries = parsed.decisions.map((decision, index) => withPrediction(fill(templates.entry, {
    number: String(index + 1),
    title: decision.topic,
    prompt: decision.context,
    options: formatOptions(decision.options),
    choice: decision.choice,
    reason: decision.reason,
    date: decision.date,
  }), decision.prediction));
  return fill(templates.page, {
    goal: parsed.goal,
    entries: entries.join("\n\n"),
  });
}

export function listCodeFiles(root) {
  const found = [];
  function walk(directory, depth) {
    if (depth > 12 || found.length > 40) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length > 40) return;
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name === ".praxis") continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (SOURCE_EXT.has(path.extname(entry.name))) {
        found.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  }
  walk(root, 0);
  found.sort();
  return { files: found.slice(0, 40), truncated: found.length > 40 };
}

export function syncMap(existing, files, truncated = false) {
  let text = existing.trim().length > 0 ? `${existing.replace(/\s*$/, "")}\n` : "# Map\n\n## Parts\n\n## Unknowns\n";
  if (!/^# Map\b/m.test(text)) text = `# Map\n\n${text}`;
  if (!/^## Parts[ \t]*$/m.test(text)) {
    text = text.replace(/^# Map[^\n]*\n?/, (heading) => `${heading.trimEnd()}\n\n## Parts\n`);
  }
  if (!/^## Unknowns[ \t]*$/m.test(text)) text = `${text.replace(/\s*$/, "")}\n\n## Unknowns\n`;
  for (const file of files) {
    if (!sectionMentions(text, "Parts", file)) text = insertLine(text, "Parts", `- ${file}`);
    if (!described(text, file) && !sectionMentions(text, "Unknowns", file)) {
      text = insertLine(text, "Unknowns", `- ${file}`);
    }
  }
  if (truncated && !text.includes("Further files were not listed.")) {
    text = insertLine(text, "Unknowns", "- Further files were not listed.");
  }
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function ensureMap(root) {
  if (isPluginProject(root)) return "";
  const listed = listCodeFiles(root);
  if (listed.files.length === 0) return "";
  const notes = path.join(root, ".praxis");
  const mapPath = path.join(notes, "map.md");
  const existing = existsSync(mapPath) ? readFileSync(mapPath, "utf8") : "";
  const next = syncMap(existing, listed.files, listed.truncated);
  if (next !== existing) {
    mkdirSync(notes, { recursive: true });
    writeFileSync(mapPath, next);
  }
  return MAP_NOTE;
}

export function writeRecord(root) {
  if (isPluginProject(root)) return false;
  const notesPath = path.join(root, ".praxis", "decisions.md");
  let notes;
  try {
    notes = readFileSync(notesPath, "utf8");
  } catch {
    return false;
  }
  if (parseDecisions(notes).decisions.length === 0) return false;
  const rendered = renderDecisions(notes, loadTemplates());
  writeFileSync(path.join(root, "DECISIONS.md"), rendered.endsWith("\n") ? rendered : `${rendered}\n`);
  return true;
}

function parseBlock(block) {
  const body = block.split(/^## End[ \t]*$/m)[0] ?? "";
  const reasonAt = body.search(/^Reason:\r?\n/m);
  if (reasonAt < 0) return null;
  const head = body.slice(0, reasonAt);
  const reasonAndRest = body.slice(reasonAt).replace(/^Reason:\r?\n/, "");
  const predictionAt = reasonAndRest.search(/^Prediction:\r?\n/m);
  const reason = (predictionAt >= 0 ? reasonAndRest.slice(0, predictionAt) : reasonAndRest).replace(/\n$/, "");
  const prediction = predictionAt >= 0
    ? reasonAndRest.slice(predictionAt).replace(/^Prediction:\r?\n/, "").replace(/\n$/, "")
    : "";
  const field = (name) => {
    const match = new RegExp(`^${name}:[ \t]*(.*)$`, "m").exec(head);
    return match ? match[1] : "";
  };
  return {
    topic: field("Topic"),
    context: field("Context"),
    options: field("Options"),
    choice: field("Choice"),
    date: field("Date"),
    reason,
    prediction,
  };
}

function withPrediction(entry, prediction) {
  if (prediction.length === 0) return entry;
  return `${entry.replace(/\s*$/, "")}\n- **Prediction:** ${prediction}`;
}

export function isPluginProject(root) {
  return existsSync(path.join(root, ".cursor-plugin", "plugin.json"))
    && existsSync(path.join(root, "rules", "praxis.mdc"));
}

function described(text, file) {
  return text.split(/\r?\n/).some((line) => mentionsPath(line, file) && line.trim() !== `- ${file}`);
}

function sectionMentions(text, heading, file) {
  const body = sectionBody(text, heading);
  return body !== null && mentionsPath(body, file);
}

function sectionBody(text, heading) {
  const match = new RegExp(`^## ${heading}[ \\t]*$`, "m").exec(text);
  if (!match) return null;
  const rest = text.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

function mentionsPath(text, file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\w./-])${escaped}(?![\\w./-])`, "m").test(text);
}

function insertLine(text, heading, line) {
  const body = sectionBody(text, heading);
  if (body === null) return text;
  if (body.split(/\r?\n/).some((item) => item.trim() === line)) return text;
  const match = new RegExp(`^## ${heading}[ \\t]*$`, "m").exec(text);
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^## /m);
  const end = next === -1 ? text.length : start + next;
  const before = text.slice(0, end).replace(/\s*$/, "");
  const after = text.slice(end);
  if (after.length === 0) return `${before}\n${line}\n`;
  if (after.startsWith("## ")) return `${before}\n${line}\n\n${after}`;
  return `${before}\n${line}\n${after.replace(/^\n/, "")}`;
}

function formatOptions(options) {
  return options.split("|").map((part) => `- ${part.trim()}`).join("\n");
}

function fill(template, values) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => {
    const value = values[key];
    return value === undefined ? match : value;
  });
}

function loadTemplates() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");
  return {
    page: readFileSync(path.join(root, "decisions.md"), "utf8"),
    entry: readFileSync(path.join(root, "decision-entry.md"), "utf8"),
  };
}
