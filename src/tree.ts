import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import * as z from "zod/v4";
import { CoachError } from "./errors.js";
import { packageRoot } from "./paths.js";
import { AREAS, LEVELS, type Question } from "./types.js";

const optionSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  pros: z.array(z.string().min(1)).min(1),
  cons: z.array(z.string().min(1)).min(1),
});

const questionSchema = z.strictObject({
  id: z.enum(AREAS),
  area: z.enum(AREAS),
  title: z.string().min(1),
  prompt: z.string().min(1),
  options: z.array(optionSchema).min(2),
  recommendation: z.strictObject({
    beginner: z.string().min(1),
    intermediate: z.string().min(1),
    advanced: z.string().min(1),
  }),
  whyRubric: z.array(z.string().min(1)).min(2),
  idk: z.strictObject({
    subquestions: z.array(z.strictObject({
      id: z.string().min(1),
      prompt: z.string().min(1),
      options: z.array(z.strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        note: z.string().min(1),
      })).min(2),
    })).min(1),
    explain: z.strictObject({
      explanation: z.string().min(1),
      recommend: z.string().min(1),
    }),
  }),
});

const treeSchema = z.strictObject({
  questions: z.array(questionSchema).length(AREAS.length),
});

let cached: Question[] | undefined;

export function parseCoreTree(document: unknown): Question[] {
  const parsed = treeSchema.safeParse(document);
  if (!parsed.success) {
    throw new CoachError(`Core tree is invalid: ${z.prettifyError(parsed.error)}`);
  }

  parsed.data.questions.forEach((question, index) => {
    const expected = AREAS[index];
    if (question.id !== expected || question.area !== expected) {
      throw new CoachError(`Core question ${index + 1} must be "${expected}".`);
    }
    const optionIds = new Set(question.options.map((option) => option.id));
    if (optionIds.size !== question.options.length) {
      throw new CoachError(`Question "${question.id}" repeats an option id.`);
    }
    for (const level of LEVELS) {
      if (!optionIds.has(question.recommendation[level])) {
        throw new CoachError(`Question "${question.id}" recommends an unknown option for ${level}.`);
      }
    }
    if (!optionIds.has(question.idk.explain.recommend)) {
      throw new CoachError(`Question "${question.id}" explains an unknown option.`);
    }
  });

  return parsed.data.questions;
}

export function loadCoreTree(): Question[] {
  cached ??= parseCoreTree(readYaml(path.join(packageRoot(), "questions", "core.yaml")));
  return cached;
}

export function resetCoreTreeCache(): void {
  cached = undefined;
}

function readYaml(file: string): unknown {
  try {
    return parse(readFileSync(file, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new CoachError(`Could not parse ${file}: ${message}`);
  }
}
