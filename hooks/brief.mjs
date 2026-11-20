import { readFileSync } from "node:fs";
import path from "node:path";
import { classifyPath, isPluginProject, listCodeFiles, packageFrameworks } from "./record.mjs";

const SHOWN = ["data access", "API boundary", "deployment", "entry point", "configuration", "package manager"];

export function projectBrief(root) {
  if (isPluginProject(root) || hasDecisions(root)) return "";
  const goal = projectGoal(root);
  const listed = listCodeFiles(root);
  const lines = [];
  for (const role of SHOWN) {
    const files = listed.files.filter((file) => classifyPath(file) === role);
    if (files.length === 0) continue;
    lines.push(`- ${role}: ${files.slice(0, 3).join(", ")}`);
  }
  const frameworks = packageFrameworks(root);
  if (frameworks.length > 0) lines.push(`- framework: ${frameworks.join(", ")}`);
  const tests = listed.files.filter((file) => classifyPath(file) === "test").length;
  if (tests > 0) lines.push(`- tests: ${tests}`);
  if (goal.length === 0 && lines.length === 0) return "";
  const parts = ["The project already has work in the tree. Use this only as context. It is not their sentence and it is not a decision."];
  if (goal.length > 0) parts.push(`Goal: ${goal}`);
  if (lines.length > 0) parts.push("Already in the tree:", ...lines);
  if (listed.truncated) parts.push("The map is capped, so this list is not the whole tree.");
  parts.push("Ask for their sentence before offering a stack, a database, or a deployment.");
  return parts.join("\n");
}

function projectGoal(root) {
  const heading = /^#\s+(.+)$/m.exec(readText(path.join(root, "README.md")));
  if (heading && heading[1].trim().length > 0) return heading[1].trim();
  try {
    const pkg = JSON.parse(readText(path.join(root, "package.json")) || "null");
    if (pkg && typeof pkg.description === "string" && pkg.description.trim().length > 0) return pkg.description.trim();
    if (pkg && typeof pkg.name === "string" && pkg.name.trim().length > 0) return pkg.name.trim();
  } catch {
    return "";
  }
  return "";
}

function hasDecisions(root) {
  try {
    return readFileSync(path.join(root, ".praxis", "decisions.md"), "utf8").includes("## Decision");
  } catch {
    return false;
  }
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
