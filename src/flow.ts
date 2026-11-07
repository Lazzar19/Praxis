import { CoachError } from "./errors.js";
import { renderExport, writeExport } from "./render.js";
import { readSession, resolveProjectRoot, writeSession } from "./session.js";
import { loadCoreTree } from "./tree.js";
import {
  AREAS,
  LEVELS,
  type Answer,
  type AreaId,
  type Clock,
  type HandsOn,
  type Level,
  type Question,
  type Session,
} from "./types.js";

export interface FlowOptions {
  projectRoot: string;
  coachRoot?: string;
  clock?: Clock;
  tree?: readonly Question[];
}

export interface StartSessionInput {
  goal: string;
  levels?: Partial<Record<AreaId, Level>>;
  handsOn?: HandsOn;
  reset?: boolean;
}

export interface StartSessionResult {
  status: "created" | "exists";
  goal: string;
  answered: number;
  total: number;
  exported: boolean;
  handsOn: HandsOn;
  levels: Record<AreaId, Level>;
}

export interface QuestionView {
  status: "question";
  index: number;
  total: number;
  exported: boolean;
  question: {
    id: AreaId;
    area: AreaId;
    title: string;
    prompt: string;
    level: Level;
    recommendation: { optionId: string; label: string };
    options: Question["options"];
  };
}

export interface ReadyView {
  status: "ready";
  total: number;
  answered: number;
  exported: boolean;
}

export interface RecordResult {
  questionId: AreaId;
  optionId: string;
  reason: string;
  remaining: number;
}

export interface ExportResult {
  decisionsPath: string;
  planPath: string;
  decisionCount: number;
}

interface ResolvedFlow {
  projectRoot: string;
  clock: Clock;
  tree: readonly Question[];
  coachRoot?: string;
}

export function startSession(options: FlowOptions, input: StartSessionInput): StartSessionResult {
  const flow = resolveFlow(options);
  const existing = readSession(flow.projectRoot, flow.coachRoot);
  if (existing && !input.reset) {
    return sessionStatus("exists", existing, flow.tree.length);
  }

  const goal = input.goal.trim();
  if (goal.length === 0) {
    throw new CoachError("goal is required.");
  }

  const now = flow.clock().toISOString();
  const session: Session = {
    version: 1,
    goal,
    levels: normalizeLevels(input.levels),
    handsOn: input.handsOn ?? "todos",
    answers: [],
    startedAt: now,
    exportedAt: null,
  };
  writeSession(flow.projectRoot, session, flow.coachRoot);
  return sessionStatus("created", session, flow.tree.length);
}

export function nextQuestion(options: FlowOptions): QuestionView | ReadyView {
  const flow = resolveFlow(options);
  const session = requireSession(flow);
  const current = currentQuestion(session, flow.tree);
  if (!current) {
    return {
      status: "ready",
      total: flow.tree.length,
      answered: session.answers.length,
      exported: session.exportedAt !== null,
    };
  }

  const level = session.levels[current.question.area];
  const recommendedId = current.question.recommendation[level];
  const recommended = current.question.options.find((option) => option.id === recommendedId);
  if (!recommended) {
    throw new CoachError(`Question "${current.question.id}" has no recommendation for ${level}.`);
  }

  return {
    status: "question",
    index: current.index + 1,
    total: flow.tree.length,
    exported: session.exportedAt !== null,
    question: {
      id: current.question.id,
      area: current.question.area,
      title: current.question.title,
      prompt: current.question.prompt,
      level,
      recommendation: { optionId: recommended.id, label: recommended.label },
      options: current.question.options,
    },
  };
}

export function recordAnswer(
  options: FlowOptions,
  input: { questionId: string; optionId: string; reason: string },
): RecordResult {
  const flow = resolveFlow(options);
  const session = requireSession(flow);
  if (session.exportedAt) {
    throw new CoachError("This session is already exported. Start again with reset true to change a decision.");
  }

  const current = currentQuestion(session, flow.tree);
  if (!current) {
    throw new CoachError("Every core question already has an answer.");
  }
  if (input.questionId !== current.question.id) {
    throw new CoachError(`The current question is "${current.question.id}", not "${input.questionId}".`);
  }
  if (input.reason.trim().length === 0) {
    throw new CoachError("A reason is required.");
  }

  const option = current.question.options.find((item) => item.id === input.optionId);
  if (!option) {
    throw new CoachError(`"${input.optionId}" is not an option for "${current.question.id}".`);
  }

  const answer: Answer = {
    questionId: current.question.id,
    optionId: option.id,
    reason: input.reason,
    answeredAt: flow.clock().toISOString(),
  };
  const updated: Session = { ...session, answers: [...session.answers, answer] };
  writeSession(flow.projectRoot, updated, flow.coachRoot);
  return {
    questionId: answer.questionId,
    optionId: answer.optionId,
    reason: answer.reason,
    remaining: flow.tree.length - updated.answers.length,
  };
}

export function exportDecisions(options: FlowOptions): ExportResult {
  const flow = resolveFlow(options);
  const session = requireSession(flow);
  assertComplete(session, flow.tree);
  const rendered = renderExport(session, flow.tree);
  const paths = writeExport(flow.projectRoot, rendered);
  const exportedAt = flow.clock().toISOString();
  writeSession(flow.projectRoot, { ...session, exportedAt }, flow.coachRoot);
  return { ...paths, decisionCount: flow.tree.length };
}

export function formatQuestion(view: QuestionView): string {
  const lines = [
    `Question ${view.index} of ${view.total} — ${view.question.title}`,
    view.question.prompt,
    "",
    `Recommended for ${view.question.level}: ${view.question.recommendation.label} (${view.question.recommendation.optionId}). This stays a suggestion until the student records a choice.`,
    "",
    "Options:",
  ];
  for (const option of view.question.options) {
    lines.push(`- ${option.label} (${option.id})`);
    lines.push(`  Pros: ${option.pros.join(" ")}`);
    lines.push(`  Cons: ${option.cons.join(" ")}`);
  }
  return lines.join("\n");
}

export function formatReady(view: ReadyView): string {
  if (view.exported) {
    return `All ${view.total} core decisions are recorded and already exported.`;
  }
  return `All ${view.total} core decisions are recorded. Call export_decisions to write DECISIONS.md and PLAN.md.`;
}

export function formatStart(result: StartSessionResult): string {
  const progress = `${result.answered} of ${result.total} decisions recorded.`;
  if (result.status === "exists") {
    return `A session already exists for "${result.goal}". ${progress} Pass reset true to replace it.`;
  }
  return `Started a session for "${result.goal}". ${progress} Call next_question.`;
}

export function formatRecord(result: RecordResult): string {
  return [
    `Recorded ${result.questionId} = ${result.optionId}.`,
    `Reason: ${result.reason}`,
    `Remaining: ${result.remaining}.`,
  ].join("\n");
}

export function formatExport(result: ExportResult): string {
  return `Wrote ${result.decisionsPath} and ${result.planPath} (${result.decisionCount} decisions).`;
}

function resolveFlow(options: FlowOptions): ResolvedFlow {
  return {
    projectRoot: resolveProjectRoot(options.projectRoot, options.coachRoot),
    clock: options.clock ?? (() => new Date()),
    tree: options.tree ?? loadCoreTree(),
    coachRoot: options.coachRoot,
  };
}

function requireSession(flow: ResolvedFlow): Session {
  const session = readSession(flow.projectRoot, flow.coachRoot);
  if (!session) {
    throw new CoachError("No session in this project. Call start_session first.");
  }
  return session;
}

function currentQuestion(session: Session, tree: readonly Question[]): { question: Question; index: number } | null {
  const answered = new Set(session.answers.map((answer) => answer.questionId));
  const index = tree.findIndex((question) => !answered.has(question.id));
  const question = tree[index];
  if (!question || index < 0) return null;
  return { question, index };
}

function assertComplete(session: Session, tree: readonly Question[]): void {
  const ids = session.answers.map((answer) => answer.questionId);
  if (new Set(ids).size !== ids.length) {
    throw new CoachError("The session repeats a question.");
  }
  for (const answer of session.answers) {
    if (!tree.some((question) => question.id === answer.questionId)) {
      throw new CoachError(`The session has an unknown question "${answer.questionId}".`);
    }
  }
  const missing = tree.filter((question) => !ids.includes(question.id));
  if (missing.length > 0) {
    throw new CoachError(`Export waits for: ${missing.map((question) => question.id).join(", ")}.`);
  }
}

function normalizeLevels(input: Partial<Record<AreaId, Level>> | undefined): Record<AreaId, Level> {
  const levels = {} as Record<AreaId, Level>;
  for (const area of AREAS) {
    const level = input?.[area];
    if (level !== undefined && !LEVELS.includes(level)) {
      throw new CoachError(`Unknown level "${level}" for ${area}.`);
    }
    levels[area] = level ?? "intermediate";
  }
  return levels;
}

function sessionStatus(status: "created" | "exists", session: Session, total: number): StartSessionResult {
  return {
    status,
    goal: session.goal,
    answered: session.answers.length,
    total,
    exported: session.exportedAt !== null,
    handsOn: session.handsOn,
    levels: session.levels,
  };
}
