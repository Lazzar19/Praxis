import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as z from "zod/v4";
import { CoachError } from "./errors.js";
import { packageRoot } from "./paths.js";
import { additionsSchema } from "./additions.js";
import { blankLevelCounts, emptyAdditions, HANDS_ON, LEVELS, type Session } from "./types.js";

const countsSchema = z.strictObject({
  idk: z.number().int().nonnegative(),
  cleanPasses: z.number().int().nonnegative(),
});

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
    questionId: z.string().min(1),
    optionId: z.string().min(1),
    reason: z.string().min(1),
    answeredAt: z.iso.datetime(),
  })),
  startedAt: z.iso.datetime(),
  exportedAt: z.iso.datetime().nullable(),
  levelCounts: z.strictObject({
    stack: countsSchema,
    database: countsSchema,
    api: countsSchema,
    auth: countsSchema,
    deploy: countsSchema,
  }).optional(),
  pending: z.strictObject({
    questionId: z.string().min(1),
    optionId: z.string().min(1),
    attempts: z.number().int().positive(),
    hint: z.string().min(1),
    draft: z.string(),
  }).nullable().optional(),
  idk: z.strictObject({
    questionId: z.string().min(1),
    step: z.number().int().nonnegative(),
  }).nullable().optional(),
  idkSeen: z.array(z.string()).optional(),
  explainQuestionId: z.string().nullable().optional(),
  modelEnabled: z.boolean().optional(),
  additions: additionsSchema.optional(),
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
  return {
    ...parsed.data,
    levelCounts: parsed.data.levelCounts ?? blankLevelCounts(),
    pending: parsed.data.pending ?? null,
    idk: parsed.data.idk ?? null,
    idkSeen: parsed.data.idkSeen ?? [],
    explainQuestionId: parsed.data.explainQuestionId ?? null,
    modelEnabled: parsed.data.modelEnabled ?? true,
    additions: parsed.data.additions ?? emptyAdditions(),
  };
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
