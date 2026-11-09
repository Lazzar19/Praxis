import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".rs", ".rb", ".php", ".cs", ".cpp", ".c", ".h", ".swift", ".kt",
]);

export const MAP_NOTE = "A map of the existing code is in .learn-coach/map.md. Mark anything you could not see under Unknowns before asking a new question.";

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
  const entries = parsed.decisions.map((decision, index) => fill(templates.entry, {
    number: String(index + 1),
    title: decision.topic,
    prompt: decision.context,
    options: formatOptions(decision.options),
    choice: decision.choice,
    reason: decision.reason,
    date: decision.date,
  }));
  return fill(templates.page, {
    goal: parsed.goal,
    entries: entries.join("\n\n"),
  });
}

export function listCodeFiles(root) {
  const found = [];
  function walk(directory, depth) {
    if (depth > 4 || found.length >= 40) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= 40) return;
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name === ".learn-coach") continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (SOURCE_EXT.has(path.extname(entry.name))) {
        found.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  }
  walk(root, 0);
  found.sort();
  return found;
}

export function ensureMap(root) {
  const files = listCodeFiles(root);
  if (files.length === 0) return "";
  const notes = path.join(root, ".learn-coach");
  const mapPath = path.join(notes, "map.md");
  if (!existsSync(mapPath)) {
    mkdirSync(notes, { recursive: true });
    const extra = files.length >= 40 ? "\n- Further files were not listed." : "";
    const parts = files.map((file) => `- ${file}`).join("\n");
    writeFileSync(mapPath, `# Map\n\n## Parts\n${parts}${extra}\n\n## Unknowns\n- What each listed part does, until it is read\n`);
  }
  return MAP_NOTE;
}

export function writeRecord(root) {
  const notesPath = path.join(root, ".learn-coach", "decisions.md");
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
  const reason = body.slice(reasonAt).replace(/^Reason:\r?\n/, "").replace(/\n$/, "");
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
  };
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
