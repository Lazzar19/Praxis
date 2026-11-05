import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as z from "zod/v4";
import { CoachError } from "./errors.js";
import { packageRoot } from "./paths.js";
import { AREAS, HANDS_ON, LEVELS, type Session } from "./types.js";

const sessionSchema = z.strictObject({
  version: z.literal(1),
  goal: z.string().min(1),
  levels: z.strictObject({
    stack: z.enum(LEVELS),
    database: z.enum(LEVELS),
    api: z.enum(LEVELS),
    auth: z.enum(LEVELS),
    deploy: z.enum(LEVELS),
  }),
  handsOn: z.enum(HANDS_ON),
  answers: z.array(z.strictObject({
    questionId: z.enum(AREAS),
    optionId: z.string().min(1),
    reason: z.string().min(1),
    answeredAt: z.iso.datetime(),
  })),
  startedAt: z.iso.datetime(),
  exportedAt: z.iso.datetime().nullable(),
});

export function resolveProjectRoot(projectRoot: string, coachRoot = packageRoot()): string {
  const resolved = path.resolve(projectRoot);
  if (resolved === path.resolve(coachRoot)) {
    throw new CoachError("projectRoot must be the student project, not the learn-coach repository.");
  }
  let info;
  try {
    info = statSync(resolved);
  } catch {
    throw new CoachError(`Project directory does not exist: ${resolved}`);
  }
  if (!info.isDirectory()) {
    throw new CoachError(`Project path is not a directory: ${resolved}`);
  }
  return resolved;
}

export function sessionFile(projectRoot: string, coachRoot = packageRoot()): string {
  return path.join(resolveProjectRoot(projectRoot, coachRoot), ".learn-coach", "session.json");
}

export function readSession(projectRoot: string, coachRoot = packageRoot()): Session | null {
  const file = sessionFile(projectRoot, coachRoot);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    throw new CoachError(`Session file is not valid JSON: ${file}`);
  }

  const parsed = sessionSchema.safeParse(document);
  if (!parsed.success) {
    throw new CoachError(`Session file is invalid: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function writeSession(projectRoot: string, session: Session, coachRoot = packageRoot()): void {
  const file = sessionFile(projectRoot, coachRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
