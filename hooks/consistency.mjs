import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { listCodeFiles, parseDecisions, previewRecord } from "./record.mjs";

const MARKER = /TODO\(praxis:([^)]+)\)/g;

export function sessionProblems(root, progress) {
  const problems = [];
  const notes = readText(path.join(root, ".praxis", "decisions.md"));
  const parsed = notes.length > 0 ? parseDecisions(notes) : { decisions: [] };
  const decisions = parsed.decisions;
  const headings = notes.match(/^## Decision[ \t]*$/gm)?.length ?? 0;
  if (progress.status === "confirmed" && decisions.length === 0) {
    problems.push('progress says "confirmed" and no matching decision was found.');
  }
  if (headings > decisions.length) problems.push("a decision block is damaged and has no Reason.");
  const markers = sourceMarkers(root);
  for (const marker of markers) {
    if (!decisions.some((decision) => matches(decision, marker.token))) {
      problems.push(marker.token.includes(" ")
        ? `marker exists in ${marker.file} and no matching decision was found.`
        : `marker exists in ${marker.file} for unknown Decision ID ${marker.token}.`);
    }
  }
  for (const mark of readMarks(root)) {
    if (!existsSync(path.resolve(root, mark.file))) problems.push(`marks.md lists ${mark.file}, and that file is missing.`);
    else if (!decisions.some((decision) => matches(decision, mark.topic))) {
      problems.push(`marks.md lists ${mark.topic} in ${mark.file}, and no matching decision was found.`);
    }
  }
  const review = readText(path.join(root, ".praxis", "review.md"));
  const recorded = readMarks(root);
  if (progress.status === "confirmed") {
    for (const decision of decisions) {
      if (decision.prediction.length === 0) continue;
      if (hasVerdict(review, decision)) continue;
      if (markers.some((marker) => matches(decision, marker.token))) continue;
      if (recorded.some((mark) => matches(decision, mark.topic) && existsSync(path.resolve(root, mark.file)))) continue;
      const token = decision.decisionId.length > 0 ? decision.decisionId : decision.topic;
      problems.push(`the decision "${decision.topic}" has no marker. Leave TODO(praxis:${token}) for the student before reviewing it.`);
    }
  }
  const rendered = previewRecord(root);
  const exported = readText(path.join(root, "DECISIONS.md"));
  if (rendered.length > 0 && exported.length > 0 && exported !== rendered) {
    problems.push("DECISIONS.md is stale and will be regenerated from .praxis/decisions.md.");
  }
  if (problems.length === 0) return "";
  return `Praxis found an inconsistent session:\n${problems.map((problem) => `- ${problem}`).join("\n")}\nRepair these notes before starting a new debate.`;
}

function matches(decision, token) {
  return decision.topic === token || (decision.decisionId.length > 0 && decision.decisionId === token);
}

function sourceMarkers(root) {
  const found = [];
  for (const file of listCodeFiles(root).files) {
    let source = "";
    try {
      source = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(MARKER)) found.push({ file, token: match[1] });
  }
  return found;
}

function readMarks(root) {
  const text = readText(path.join(root, ".praxis", "marks.md"));
  return text.split(/^## Mark[ \t]*$/m).slice(1).map((block) => {
    const topic = /^Topic:[ \t]*(.*)$/m.exec(block)?.[1] ?? "";
    const file = /^File:[ \t]*(.*)$/m.exec(block)?.[1] ?? "";
    return topic.length > 0 && file.length > 0 ? { topic, file } : null;
  }).filter((mark) => mark !== null);
}

function hasVerdict(review, decision) {
  return review.split(/^## Review[ \t]*$/m).slice(1).some((block) => {
    const topic = /^Topic:[ \t]*(.*)$/m.exec(block)?.[1] ?? "";
    const matched = /^Matched:[ \t]*(yes|partial|no|blocked)[ \t]*$/im.test(block);
    return matched && (topic === decision.topic || topic === decision.decisionId);
  });
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
