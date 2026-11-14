import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseDecisions } from "./record.mjs";

const LEVELS = {
  beginner: "Their level is beginner. Use more definitions, smaller steps, and simpler trade-offs.",
  intermediate: "Their level is intermediate. Use fewer basic definitions and more comparisons.",
  advanced: "Their level is advanced. Raise edge cases, failure modes, security, and operational trade-offs.",
};

export function learningNote(root, progress) {
  const parts = [];
  const level = progress.level.length > 0 ? progress.level : levelFromNotes(root);
  if (LEVELS[level]) parts.push(LEVELS[level]);
  if (progress.adapt === "off") {
    parts.push("Adaptation is off. Keep the level they chose and do not change the step size from past results.");
    return parts.join(" ");
  }
  const hint = performanceHint(root);
  if (hint.length > 0) parts.push(hint);
  return parts.join(" ");
}

export function progressNote(root, progress) {
  if (progress.track === "clear") {
    rmSync(learningFile(), { force: true });
    return "Local progress was deleted. Nothing was sent anywhere.";
  }
  if (progress.track !== "on") return "";
  const others = otherProjects(root);
  const practiced = summarize(others);
  const record = practiced.length > 0
    ? `Past practice: ${practiced}.`
    : "No past practice is recorded yet.";
  return `Local progress is on, and it stays on this computer. ${record} Do not send this record to an external service. They delete it by writing Progress: clear.`;
}

export function rememberProgress(root, progress) {
  if (progress.track === "clear") {
    rmSync(learningFile(), { force: true });
    return;
  }
  if (progress.track !== "on") return;
  const data = readLearning();
  data.projects[projectId(root)] = snapshot(root, progress);
  const file = learningFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function performanceHint(root) {
  const decisions = readDecisions(root);
  const takes = decisions.filter((decision) => /take the proposal/i.test(decision.choice)).length;
  const idk = decisions.filter((decision) => /idk|i don't know|i do not know/i.test(`${decision.choice}\n${decision.reason}`)).length;
  const matched = countMatches(readText(path.join(root, ".praxis", "review.md")));
  const lines = [];
  if (takes >= 2) lines.push("They have taken the proposal more than once. Ask them to compare two alternatives before the next proposal.");
  if (idk >= 2) lines.push("They have answered idk more than once. Ask a grounding question before the next option list.");
  if (matched.no + matched.partial >= 2 && matched.yes === 0) lines.push("Predictions have missed. Reduce the size of the next step.");
  if (matched.yes >= 2 && matched.no === 0 && matched.partial === 0) lines.push("Predictions have held. Increase the complexity of the next decision.");
  if (lines.length === 0) return "";
  return `Praxis is adapting from their results. ${lines.join(" ")} Say that in one sentence before the next debate.`;
}

function levelFromNotes(root) {
  const level = readDecisions(root).find((decision) => /level/i.test(decision.topic));
  const choice = (level?.choice ?? "").toLowerCase();
  return LEVELS[choice] ? choice : "";
}

function snapshot(root, progress) {
  const notes = readText(path.join(root, ".praxis", "decisions.md"));
  const parsed = notes.length > 0 ? parseDecisions(notes) : { goal: "", decisions: [] };
  return {
    goal: parsed.goal,
    topics: parsed.decisions.map((decision) => decision.topic),
    choices: parsed.decisions.map((decision) => decision.choice).filter((choice) => choice.length > 0),
    level: progress.level,
    idk: parsed.decisions.filter((decision) => /idk|i don't know|i do not know/i.test(`${decision.choice}\n${decision.reason}`)).length,
    matched: countMatches(readText(path.join(root, ".praxis", "review.md"))),
  };
}

function countMatches(review) {
  const matched = { yes: 0, partial: 0, no: 0, blocked: 0 };
  for (const block of review.split(/^## Review[ \t]*$/m).slice(1)) {
    const value = /^Matched:[ \t]*(yes|partial|no|blocked)[ \t]*$/im.exec(block)?.[1]?.toLowerCase();
    if (value && matched[value] !== undefined) matched[value] += 1;
  }
  return matched;
}

function otherProjects(root) {
  const data = readLearning();
  const current = projectId(root);
  return Object.entries(data.projects).filter(([id]) => id !== current);
}

function summarize(entries) {
  return entries.map(([, project]) => {
    const title = typeof project.goal === "string" && project.goal.length > 0 ? project.goal : "A past project";
    const topics = Array.isArray(project.topics)
      ? project.topics.filter((topic) => typeof topic === "string" && !/level/i.test(topic))
      : [];
    const subject = topics.length > 0 ? topics.join(", ") : "no topic yet";
    const matched = project.matched && typeof project.matched === "object" ? project.matched : {};
    const tally = ["yes", "partial", "no", "blocked"]
      .filter((key) => Number(matched[key]) > 0)
      .map((key) => `${key} ${matched[key]}`)
      .join(", ");
    return tally.length > 0 ? `${title}: ${subject} (${tally})` : `${title}: ${subject}`;
  }).join("; ");
}

function readDecisions(root) {
  const notes = readText(path.join(root, ".praxis", "decisions.md"));
  return notes.length > 0 ? parseDecisions(notes).decisions : [];
}

function readLearning() {
  try {
    const parsed = JSON.parse(readFileSync(learningFile(), "utf8"));
    if (!parsed || typeof parsed !== "object" || !parsed.projects || typeof parsed.projects !== "object") return { projects: {} };
    return parsed;
  } catch {
    return { projects: {} };
  }
}

function projectId(root) {
  return createHash("sha256").update(path.resolve(root)).digest("hex");
}

function learningFile() {
  if (process.env.PRAXIS_STATE_DIR && process.env.PRAXIS_STATE_DIR.length > 0) {
    return path.join(process.env.PRAXIS_STATE_DIR, "learning.json");
  }
  return path.join(homedir(), ".local", "state", "praxis", "learning.json");
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
