import { readFileSync } from "node:fs";
import path from "node:path";
import { isPluginProject, parseDecisions } from "./record.mjs";

export function recallNote(root, progress) {
  if (isPluginProject(root) || progress.status !== "confirmed") return "";
  const decisions = reviewedDecisions(root);
  const recalls = readRecalls(readText(path.join(root, ".praxis", "recall.md")));
  const open = decisions.find((decision) => {
    const recall = recallFor(recalls, decision);
    return recall && recall.holds === "no";
  });
  if (open) {
    const recall = recallFor(recalls, open);
    return `The recall for ${open.topic} did not hold. Answer: ${recall.answer}\nSet Status: pending and Topic: what changed. Take their sentence about what changed before any option list. Do not write that sentence for them.`;
  }
  const next = decisions.find((decision) => !recallFor(recalls, decision));
  if (!next) return "";
  return `Recall one decision in this later chat. Topic: ${next.topic}. Prediction: ${next.prediction}\nAskQuestion once, with two options: it holds, or it does not hold. Do not ask in plain text. Keep their reason in .praxis/recall.md as Holds: yes or Holds: no. If it holds, leave the decision. If it does not hold, set Status: pending and Topic: what changed, then take their sentence about what changed before any option list.`;
}

function reviewedDecisions(root) {
  const notes = readText(path.join(root, ".praxis", "decisions.md"));
  const decisions = notes.length > 0 ? parseDecisions(notes).decisions : [];
  const reviews = readReviews(readText(path.join(root, ".praxis", "review.md")));
  return decisions.filter((decision) => {
    if (decision.prediction.trim().length === 0) return false;
    const review = reviews.find((item) => item.topic === decision.topic || item.topic === decision.decisionId);
    return review && review.matched !== "blocked";
  });
}

function recallFor(recalls, decision) {
  return recalls.find((item) => item.topic === decision.topic || (decision.decisionId.length > 0 && item.topic === decision.decisionId) || (decision.decisionId.length > 0 && item.decisionId === decision.decisionId));
}

function readReviews(text) {
  return text.split(/^## Review[ \t]*$/m).slice(1).map((block) => {
    const body = block.split(/^## End[ \t]*$/m)[0] ?? "";
    const topic = field(body, "Topic");
    const matched = /^Matched:[ \t]*(yes|partial|no|blocked)[ \t]*$/im.exec(body)?.[1]?.toLowerCase() ?? "";
    if (topic.length === 0 || matched.length === 0) return null;
    return { topic, matched };
  }).filter((review) => review !== null);
}

function readRecalls(text) {
  return text.split(/^## Recall[ \t]*$/m).slice(1).map((block) => {
    const body = block.split(/^## End[ \t]*$/m)[0] ?? "";
    const holds = /^Holds:[ \t]*(yes|no)[ \t]*$/im.exec(body)?.[1]?.toLowerCase() ?? "";
    if (holds.length === 0) return null;
    return {
      topic: field(body, "Topic"),
      decisionId: field(body, "Decision ID"),
      answer: field(body, "Answer"),
      holds,
    };
  }).filter((recall) => recall !== null);
}

function field(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}:[ \\t]*(.*)$`, "m").exec(body);
  if (!match) return "";
  const inline = match[1].trim();
  if (inline.length > 0) return inline;
  const rest = body.slice(match.index + match[0].length).replace(/^\r?\n/, "");
  const next = rest.search(/^(?:Topic|Decision ID|Prediction|Answer|Holds):[ \t]*/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
