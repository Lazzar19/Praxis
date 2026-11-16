import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isPluginProject, parseDecisions } from "./record.mjs";

const VERDICT = "yes|partial|no|blocked";

export function writeTimeline(root, progress) {
  if (isPluginProject(root)) return "";
  const notes = readText(path.join(root, ".praxis", "decisions.md"));
  const parsed = notes.length > 0 ? parseDecisions(notes) : { goal: "", decisions: [] };
  if (parsed.decisions.length === 0) return "";
  const reviews = readReviews(readText(path.join(root, ".praxis", "review.md")));
  const directory = path.join(root, ".praxis");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "timeline.md"), render(parsed, reviews, progress));
  return "The decision timeline is in .praxis/timeline.md. When they ask to see it, open that file beside the chat. Do not paste the timeline into the chat.";
}

function render(parsed, reviews, progress) {
  const entries = parsed.decisions.map((decision, index) => entry(decision, index, reviews));
  const open = openEntry(parsed.decisions, progress);
  const lines = [
    "# Decision timeline",
    "",
    "Confirmed decisions, in the order they were written. Open this file beside the chat.",
    "",
  ];
  if (parsed.goal.length > 0) lines.push(`Goal: ${parsed.goal}`, "");
  lines.push(entries.join("\n\n"));
  if (open.length > 0) lines.push("", open);
  lines.push("");
  return lines.join("\n");
}

function entry(decision, index, reviews) {
  const review = reviews.find((item) => item.topic === decision.topic || (decision.decisionId.length > 0 && item.decisionId === decision.decisionId));
  const lines = [`## ${index + 1}. ${decision.topic}`];
  push(lines, "Date", decision.date);
  push(lines, "Decision ID", decision.decisionId);
  push(lines, "Choice", decision.choice);
  push(lines, "Reason", decision.reason);
  push(lines, "Prediction", decision.prediction);
  if (review) {
    push(lines, "Matched", review.matched);
    push(lines, "Decision alignment", review.decisionAlignment);
    push(lines, "Prediction alignment", review.predictionAlignment);
  }
  return lines.join("\n");
}

function openEntry(decisions, progress) {
  const topic = typeof progress?.topic === "string" ? progress.topic.trim() : "";
  if (progress?.status !== "pending" || topic.length === 0) return "";
  const known = decisions.some((decision) => decision.topic === topic || decision.decisionId === topic);
  if (known) return "";
  return `## Open\n\n- **Topic:** ${topic}\n- **Status:** pending`;
}

function push(lines, label, value) {
  if (typeof value !== "string" || value.trim().length === 0) return;
  lines.push(`- **${label}:** ${value.trim()}`);
}

function readReviews(text) {
  return text.split(/^## Review[ \t]*$/m).slice(1).map((block) => {
    const body = block.split(/^## End[ \t]*$/m)[0] ?? "";
    const topic = field(body, "Topic");
    const matched = value(body, "Matched");
    if (topic.length === 0 || matched.length === 0) return null;
    return {
      decisionId: field(body, "Decision ID"),
      topic,
      matched,
      decisionAlignment: value(body, "Decision alignment"),
      predictionAlignment: value(body, "Prediction alignment"),
    };
  }).filter((review) => review !== null);
}

function value(body, name) {
  const match = new RegExp(`^${name}:[ \\t]*(${VERDICT})[ \\t]*$`, "im").exec(body);
  return match ? match[1].toLowerCase() : "";
}

function field(body, name) {
  return new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(body)?.[1]?.trim() ?? "";
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
