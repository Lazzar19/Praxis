import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { practiceTotals } from "./learn.mjs";
import { isPluginProject, parseDecisions } from "./record.mjs";

const VERDICT = "yes|partial|no|blocked";

export function writeExports(root, progress) {
  if (isPluginProject(root)) return false;
  const notes = readText(path.join(root, ".praxis", "decisions.md"));
  const parsed = notes.length > 0 ? parseDecisions(notes) : { goal: "", decisions: [] };
  if (parsed.decisions.length === 0) return false;
  const reviews = readReviews(readText(path.join(root, ".praxis", "review.md")), parsed.decisions);
  const tests = readTests(readText(path.join(root, ".praxis", "tests.md")));
  const directory = path.join(root, ".praxis", "export");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "session.json"), json(sessionExport(progress, parsed)));
  writeFileSync(path.join(directory, "review.json"), json({ reviews, tests }));
  const stats = statsExport(reviews, tests, progress);
  writeFileSync(path.join(directory, "stats.json"), json(stats));
  writeFileSync(path.join(directory, "stats.csv"), statsCsv(reviews));
  writeFileSync(path.join(directory, "portfolio.md"), portfolio(parsed, reviews));
  writeFileSync(path.join(directory, "summary.json"), json(summary(reviews)));
  return true;
}

function sessionExport(progress, parsed) {
  return {
    schemaVersion: 1,
    status: progress.status,
    topic: progress.topic,
    decisionId: progress.decisionId,
    goal: parsed.goal,
    decisions: parsed.decisions.map((decision) => ({
      decisionId: decision.decisionId,
      topic: decision.topic,
      choice: decision.choice,
    })),
  };
}

function statsExport(reviews, tests, progress) {
  const stats = { decisions: reviews.length, matched: tally(reviews), tests };
  if (progress.track === "on") stats.acrossProjects = practiceTotals();
  return stats;
}

function summary(reviews) {
  return {
    decisions: reviews.length,
    matched: tally(reviews),
    topics: reviews.map((review) => review.topic),
  };
}

function tally(reviews) {
  const matched = { yes: 0, partial: 0, no: 0, blocked: 0 };
  for (const review of reviews) {
    if (matched[review.matched] !== undefined) matched[review.matched] += 1;
  }
  return matched;
}

function portfolio(parsed, reviews) {
  const entries = parsed.decisions.map((decision) => {
    const review = reviews.find((item) => item.topic === decision.topic || (decision.decisionId.length > 0 && item.decisionId === decision.decisionId));
    const matched = review ? `\nMatched: ${review.matched}` : "";
    return `## ${decision.topic}\nChoice: ${decision.choice}\nReason: ${decision.reason}${matched}`;
  });
  return `# Portfolio\n\nGoal: ${parsed.goal}\n\n${entries.join("\n\n")}\n`;
}

function statsCsv(reviews) {
  const lines = ["topic,decision_id,decision_alignment,prediction_alignment,matched"];
  for (const review of reviews) {
    lines.push([review.topic, review.decisionId, review.decisionAlignment, review.predictionAlignment, review.matched].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function readReviews(text, decisions) {
  return text.split(/^## Review[ \t]*$/m).slice(1).map((block) => {
    const body = block.split(/^## End[ \t]*$/m)[0] ?? "";
    const topic = field(body, "Topic");
    const matched = value(body, "Matched");
    if (topic.length === 0 || matched.length === 0) return null;
    const decision = decisions.find((item) => item.topic === topic || item.decisionId === topic);
    return {
      decisionId: decision?.decisionId ?? "",
      topic: decision?.topic ?? topic,
      decisionAlignment: value(body, "Decision alignment"),
      predictionAlignment: value(body, "Prediction alignment"),
      matched,
      evidence: listUnder(body, "Evidence"),
    };
  }).filter((review) => review !== null);
}

function readTests(text) {
  return {
    passed: Number(/^-\s+(\d+)\s+passed/m.exec(text)?.[1] ?? 0),
    failed: Number(/^-\s+(\d+)\s+failed/m.exec(text)?.[1] ?? 0),
  };
}

function value(body, name) {
  const match = new RegExp(`^${name}:[ \\t]*(${VERDICT})[ \\t]*$`, "im").exec(body);
  return match ? match[1].toLowerCase() : "";
}

function field(body, name) {
  return new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(body)?.[1] ?? "";
}

function listUnder(body, name) {
  const match = new RegExp(`^${name}:[ \\t]*$`, "m").exec(body);
  if (!match) return [];
  const lines = [];
  for (const line of body.slice(match.index + match[0].length).split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const item = /^- (.*)$/.exec(line);
    if (!item) break;
    lines.push(item[1]);
  }
  return lines;
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
