import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".rs", ".rb", ".php", ".cs", ".cpp", ".c", ".h", ".swift", ".kt",
]);

export const MAP_NOTE = "A map of the existing code is in .praxis/map.md. A role is a hint. Mark anything you could not see under Unknowns before asking a new question. Debate only the parts this request changes.";

const ROLES = new Set(["entry point", "test", "package manager", "framework", "configuration", "API boundary", "data access", "deployment"]);
const FRAMEWORKS = ["next", "react", "vue", "svelte", "express", "fastify", "@nestjs/core", "django", "flask"];

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
  const entries = parsed.decisions.map((decision, index) => withPrediction(withDebate(fill(templates.entry, {
    number: String(index + 1),
    title: decision.topic,
    prompt: decision.context,
    options: formatOptions(decision.options),
    choice: decision.choice,
    reason: decision.reason,
    date: decision.date,
  }), decision), decision.prediction));
  return fill(templates.page, {
    goal: parsed.goal,
    entries: entries.join("\n\n"),
  });
}

export function classifyPath(file) {
  const norm = file.split("\\").join("/").toLowerCase();
  const base = norm.slice(norm.lastIndexOf("/") + 1);
  if (/(^|\/)(tests?|__tests__|spec)\//.test(norm) || /\.(test|spec)\.[a-z0-9]+$/.test(base)) return "test";
  if (base === "dockerfile" || base.startsWith("docker-compose") || base === "compose.yml" || base === "compose.yaml" || base === "render.yaml" || base === "fly.toml" || base === "vercel.json" || base === "netlify.toml" || base === "procfile" || norm.includes(".github/workflows/")) return "deployment";
  if (/(^|\/)(routes?|controllers?|handlers?|api)\//.test(norm)) return "API boundary";
  if (/(^|\/)(db|database|models?|repositories|data)\//.test(norm) || /^(db|database|schema)\./.test(base) || base === "schema.prisma") return "data access";
  if (base === "package.json" || base === "package-lock.json" || base === "pnpm-lock.yaml" || base === "yarn.lock" || base === "go.mod" || base === "cargo.toml" || base === "pyproject.toml" || base === "requirements.txt" || base === "pom.xml" || base === "composer.json" || base === "gemfile") return "package manager";
  if (base.endsWith(".config.js") || base.endsWith(".config.ts") || base.endsWith(".config.mjs") || base === "tsconfig.json" || base === "jsconfig.json" || base === ".env.example") return "configuration";
  if (/^(main|index|app|server)\.(ts|tsx|js|jsx|mjs|py|go|rb|php|java|kt)$/.test(base)) return "entry point";
  return "";
}

export function selectMapFiles(files) {
  const unique = [...new Set(files)];
  unique.sort((left, right) => {
    const order = (classifyPath(left) ? 0 : 1) - (classifyPath(right) ? 0 : 1);
    return order !== 0 ? order : left.localeCompare(right);
  });
  return { files: unique.slice(0, 40), truncated: unique.length > 40 };
}

export function listCodeFiles(root) {
  const roleFiles = [];
  const plain = [];
  function walk(directory, depth) {
    if (depth > 12 || (roleFiles.length >= 40 && plain.length >= 40)) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (roleFiles.length >= 40 && plain.length >= 40) return;
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name === ".praxis") continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else {
        const relative = path.relative(root, full).split(path.sep).join("/");
        const role = classifyPath(relative);
        if (role.length > 0) {
          if (roleFiles.length < 40) roleFiles.push(relative);
        } else if (SOURCE_EXT.has(path.extname(entry.name)) && plain.length < 40) {
          plain.push(relative);
        }
      }
    }
  }
  walk(root, 0);
  const selected = selectMapFiles([...roleFiles, ...plain]);
  const roles = {};
  if (selected.files.includes("package.json")) roles["package.json"] = packageRole(root);
  return { files: selected.files, roles, truncated: selected.truncated };
}

function packageRole(root) {
  let text = "";
  try {
    text = readFileSync(path.join(root, "package.json"), "utf8").toLowerCase();
  } catch {
    return "package manager";
  }
  return FRAMEWORKS.some((name) => text.includes(`"${name}"`)) ? "package manager, framework" : "package manager";
}

export function syncMap(existing, files, truncated = false, roles = {}) {
  let text = existing.trim().length > 0 ? `${existing.replace(/\s*$/, "")}\n` : "# Map\n\n## Parts\n\n## Unknowns\n";
  if (!/^# Map\b/m.test(text)) text = `# Map\n\n${text}`;
  if (!/^## Parts[ \t]*$/m.test(text)) {
    text = text.replace(/^# Map[^\n]*\n?/, (heading) => `${heading.trimEnd()}\n\n## Parts\n`);
  }
  if (!/^## Unknowns[ \t]*$/m.test(text)) text = `${text.replace(/\s*$/, "")}\n\n## Unknowns\n`;
  for (const file of files) {
    const line = mapLine(file, roles);
    if (!sectionMentions(text, "Parts", file)) text = insertLine(text, "Parts", line);
    if (!described(text, file) && !sectionMentions(text, "Unknowns", file)) {
      text = insertLine(text, "Unknowns", line);
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
  const next = syncMap(existing, listed.files, listed.truncated, listed.roles);
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

const FIELD_LABELS = ["Topic", "Context", "Their sentence", "Problem", "Reply", "Proposal", "Options", "Choice", "Date", "Reason", "Prediction"];

function parseBlock(block) {
  const body = block.split(/^## End[ \t]*$/m)[0] ?? "";
  if (!/^Reason:[ \t]*/m.test(body)) return null;
  return {
    topic: fieldValue(body, "Topic"),
    context: fieldValue(body, "Context"),
    sentence: debateValue(fieldValue(body, "Their sentence")),
    problem: debateValue(fieldValue(body, "Problem")),
    reply: debateValue(fieldValue(body, "Reply")),
    proposal: debateValue(fieldValue(body, "Proposal")),
    options: fieldValue(body, "Options"),
    choice: fieldValue(body, "Choice"),
    date: fieldValue(body, "Date"),
    reason: fieldValue(body, "Reason"),
    prediction: fieldValue(body, "Prediction"),
  };
}

function debateValue(value) {
  return /^none[ \t]*$/i.test(value) ? "" : value;
}

function fieldValue(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}:[ \\t]*(.*)$`, "m").exec(body);
  if (!match) return "";
  const inline = match[1];
  const rest = body.slice(match.index + match[0].length).replace(/^\r?\n/, "");
  const next = nextFieldIndex(rest);
  let tail = (next === -1 ? rest : rest.slice(0, next)).replace(/\n$/, "");
  if (inline.length > 0 && tail.length > 0) return `${inline}\n${tail}`;
  if (inline.length > 0) return inline;
  return tail;
}

function nextFieldIndex(text) {
  let index = -1;
  for (const name of FIELD_LABELS) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^${escaped}:[ \\t]*`, "m").exec(text);
    if (match && (index === -1 || match.index < index)) index = match.index;
  }
  return index;
}

function withDebate(entry, decision) {
  const lines = [];
  for (const [label, key] of [["Their sentence", "sentence"], ["Problem", "problem"], ["Reply", "reply"], ["Proposal", "proposal"]]) {
    const value = decision[key];
    if (typeof value === "string" && value.length > 0) lines.push(`- **${label}:** ${value}`);
  }
  if (lines.length === 0) return entry;
  return `${entry.replace(/\s*$/, "")}\n${lines.join("\n")}`;
}

function withPrediction(entry, prediction) {
  if (prediction.length === 0) return entry;
  return `${entry.replace(/\s*$/, "")}\n- **Prediction:** ${prediction}`;
}

export function isPluginProject(root) {
  return existsSync(path.join(root, ".cursor-plugin", "plugin.json"))
    && existsSync(path.join(root, "rules", "praxis.mdc"));
}

function mapLine(file, roles) {
  const role = roles[file] || classifyPath(file);
  return role.length > 0 ? `- ${file} — ${role}` : `- ${file}`;
}

function isRoleHint(line, file) {
  const prefix = `- ${file} — `;
  if (!line.trim().startsWith(prefix)) return false;
  return line.trim().slice(prefix.length).split(", ").every((part) => ROLES.has(part));
}

function described(text, file) {
  return text.split(/\r?\n/).some((line) => mentionsPath(line, file) && line.trim() !== `- ${file}` && !isRoleHint(line, file));
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
