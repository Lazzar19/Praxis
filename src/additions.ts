import * as z from "zod/v4";
import { CoachError } from "./errors.js";
import {
  AREAS,
  LEVELS,
  type AddedQuestion,
  type Option,
  type ProjectAdditions,
  type Question,
} from "./types.js";

const MAX_QUESTIONS = 3;
const MAX_OPTIONS_PER_QUESTION = 2;

const optionSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  pros: z.array(z.string().min(1)).min(1).max(3),
  cons: z.array(z.string().min(1)).min(1).max(3),
});

const questionSchema = z.strictObject({
  id: z.string().min(1),
  area: z.enum(AREAS),
  title: z.string().min(1),
  prompt: z.string().min(1),
  options: z.array(optionSchema).min(2).max(4),
  recommendation: z.strictObject({
    beginner: z.string().min(1),
    intermediate: z.string().min(1),
    advanced: z.string().min(1),
  }),
  whyRubric: z.array(z.string().min(1)).min(1).max(3),
});

export const additionsSchema = z.strictObject({
  options: z.array(z.strictObject({
    questionId: z.string().min(1),
    option: optionSchema,
  })),
  questions: z.array(questionSchema),
});

export const additionInputSchema = z.strictObject({
  options: z.array(z.strictObject({
    questionId: z.string().min(1),
    id: z.string().min(1),
    label: z.string().min(1),
    pros: z.array(z.string().min(1)).min(1).max(3),
    cons: z.array(z.string().min(1)).min(1).max(3),
  })).max(10).optional(),
  questions: z.array(questionSchema).max(MAX_QUESTIONS).optional(),
});

export const PROJECT_EXPLANATION = "This question was added for this project. Compare the pros and cons, then confirm a choice.";

export function applyAdditions(tree: readonly Question[], additions: ProjectAdditions): Question[] {
  const questions = tree.map((question) => ({ ...question, options: [...question.options] }));
  const byId = new Map(questions.map((question) => [question.id, question]));

  for (const added of additions.questions) {
    if (byId.has(added.id)) {
      throw new CoachError(`Question "${added.id}" is already in this session.`);
    }
    const question = toQuestion(added);
    questions.push(question);
    byId.set(question.id, question);
  }

  for (const added of additions.options) {
    const question = byId.get(added.questionId);
    if (!question) throw new CoachError(`Unknown question "${added.questionId}".`);
    if (question.options.some((option) => option.id === added.option.id)) {
      throw new CoachError(`Option "${added.option.id}" is already on "${added.questionId}".`);
    }
    question.options = [...question.options, added.option];
  }

  return questions;
}

export function mergeAdditions(
  tree: readonly Question[],
  current: ProjectAdditions,
  input: unknown,
  answered: ReadonlySet<string>,
): ProjectAdditions {
  const parsed = additionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CoachError(`Project additions are invalid: ${z.prettifyError(parsed.error)}`);
  }
  const incomingOptions = parsed.data.options ?? [];
  const incomingQuestions = parsed.data.questions ?? [];
  if (incomingOptions.length === 0 && incomingQuestions.length === 0) {
    throw new CoachError("Add at least one option or one question.");
  }

  const next: ProjectAdditions = {
    options: [...current.options],
    questions: [...current.questions],
  };
  const known = new Set(applyAdditions(tree, current).map((question) => question.id));

  for (const question of incomingQuestions) {
    if (known.has(question.id)) {
      throw new CoachError(`Question "${question.id}" is already in this session.`);
    }
    next.questions.push(cleanQuestion(question));
    known.add(question.id);
  }
  if (next.questions.length > MAX_QUESTIONS) {
    throw new CoachError(`A session can gain at most ${MAX_QUESTIONS} project questions.`);
  }

  for (const option of incomingOptions) {
    if (!known.has(option.questionId)) {
      throw new CoachError(`Unknown question "${option.questionId}".`);
    }
    if (answered.has(option.questionId)) {
      throw new CoachError(`"${option.questionId}" already has an answer.`);
    }
    const count = next.options.filter((item) => item.questionId === option.questionId).length;
    if (count >= MAX_OPTIONS_PER_QUESTION) {
      throw new CoachError(`A question can gain at most ${MAX_OPTIONS_PER_QUESTION} project options.`);
    }
    next.options.push({
      questionId: option.questionId,
      option: cleanOption(option),
    });
  }

  assertDistinctLabels(applyAdditions(tree, next));
  return next;
}

function assertDistinctLabels(questions: readonly Question[]): void {
  for (const question of questions) {
    const labels = question.options.map((option) => option.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      throw new CoachError(`Question "${question.id}" repeats an option label.`);
    }
  }
}

function toQuestion(added: AddedQuestion): Question {
  return {
    ...added,
    options: [...added.options],
    idk: {
      subquestions: [],
      explain: {
        explanation: PROJECT_EXPLANATION,
        recommend: added.recommendation.intermediate,
      },
    },
  };
}

function cleanQuestion(question: AddedQuestion): AddedQuestion {
  const cleaned: AddedQuestion = {
    id: cleanId(question.id, "Question id"),
    area: question.area,
    title: cleanText(question.title, 80, "Title"),
    prompt: cleanText(question.prompt, 240, "Prompt"),
    options: question.options.map((option) => cleanOption(option)),
    recommendation: { ...question.recommendation },
    whyRubric: question.whyRubric.map((phrase) => cleanText(phrase, 160, "Why rubric")),
  };
  const optionIds = new Set(cleaned.options.map((option) => option.id));
  if (optionIds.size !== cleaned.options.length) {
    throw new CoachError(`Question "${cleaned.id}" repeats an option id.`);
  }
  const labels = new Set(cleaned.options.map((option) => option.label.toLowerCase()));
  if (labels.size !== cleaned.options.length) {
    throw new CoachError(`Question "${cleaned.id}" repeats an option label.`);
  }
  for (const level of LEVELS) {
    if (!optionIds.has(cleaned.recommendation[level])) {
      throw new CoachError(`Recommendation "${cleaned.recommendation[level]}" is not an option on "${cleaned.id}".`);
    }
  }
  return cleaned;
}

function cleanOption(option: Option): Option {
  return {
    id: cleanId(option.id, "Option id"),
    label: cleanText(option.label, 80, "Label"),
    pros: option.pros.map((line) => cleanText(line, 200, "Pro")),
    cons: option.cons.map((line) => cleanText(line, 200, "Con")),
  };
}

function cleanId(value: string, label: string): string {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(value)) {
    throw new CoachError(`${label} "${value}" must be a short lowercase id.`);
  }
  if (value === "idk") throw new CoachError(`${label} "idk" is reserved.`);
  return value;
}

function cleanText(value: string, max: number, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new CoachError(`${label} must be 1 to ${max} characters.`);
  }
  return trimmed;
}
