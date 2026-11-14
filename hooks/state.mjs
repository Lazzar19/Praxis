import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;

export function syncState(root, progress) {
  const notes = path.join(root, ".praxis");
  if (!existsSync(notes)) return "";
  const file = path.join(notes, "state.json");
  let existing = null;
  let warning = "";
  if (existsSync(file)) {
    try {
      existing = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      copyFileSync(file, `${file}.bak`);
      warning = "Praxis found state.json that is not JSON. A backup is state.json.bak. progress.md is still in use.";
      existing = null;
    }
  }
  if (existing && typeof existing.schemaVersion === "number" && existing.schemaVersion > SCHEMA_VERSION) {
    return `Praxis found state.json schema ${existing.schemaVersion}, which this version does not read. Leave that file in place. progress.md is still in use.`;
  }
  if (existing && existing.schemaVersion !== SCHEMA_VERSION) {
    copyFileSync(file, `${file}.bak`);
    warning = "Praxis migrated state.json to schema 1. The previous file is state.json.bak.";
  }
  const next = projectState(progress, existing);
  const body = `${JSON.stringify(next, null, 2)}\n`;
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current !== body) writeFileSync(file, body);
  if (warning.includes("migrated") && readProgressEmpty(root)) writeFileSync(path.join(notes, "progress.md"), progressText(next));
  return warning;
}

function projectState(progress, existing) {
  const previous = existing && existing.schemaVersion !== SCHEMA_VERSION ? existing : {};
  const status = progress.status ?? stringOr(previous.status, null);
  const topic = progress.topic.length > 0 ? progress.topic : stringOr(previous.topic, "");
  const decisionId = progress.decisionId.length > 0 ? progress.decisionId : stringOr(previous.decisionId, "");
  const bypass = progress.status !== null || progress.topic.length > 0 ? progress.bypass : stringOr(previous.bypass, "none");
  const state = {
    schemaVersion: SCHEMA_VERSION,
    status,
    topic,
    decisionId,
    bypass,
    file: progress.file.length > 0 ? progress.file : stringOr(previous.file, ""),
  };
  const praxis = progress.praxis ?? stringOr(previous.praxis, "");
  if (praxis.length > 0) state.praxis = praxis;
  return state;
}

function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readProgressEmpty(root) {
  try {
    return readFileSync(path.join(root, ".praxis", "progress.md"), "utf8").trim().length === 0;
  } catch {
    return true;
  }
}

function progressText(state) {
  const lines = [];
  if (state.praxis) lines.push(`Praxis: ${state.praxis}`);
  if (state.status) lines.push(`Status: ${state.status}`);
  if (state.topic) lines.push(`Topic: ${state.topic}`);
  if (state.decisionId) lines.push(`Decision ID: ${state.decisionId}`);
  lines.push(`Bypass: ${state.bypass}`);
  return `${lines.join("\n")}\n`;
}
