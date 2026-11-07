import { applyAdditions, mergeAdditions } from "./additions.js";
import { reasonHint, reasonMatches } from "./check.js";
import { CoachError } from "./errors.js";
import { recordCleanPass, recordIdk } from "./level.js";
import { renderExport, writeExport } from "./render.js";
import { readSession, resolveProjectRoot, writeSession } from "./session.js";
import { loadCoreTree } from "./tree.js";
import {
  AREAS,
  LEVELS,
  sessionTracking,
  type Answer,
  type AreaId,
  type Clock,
  type HandsOn,
  type Level,
  type Question,
  type Session,
} from "./types.js";

const IDK = "idk";

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
  model?: boolean;
}

export interface StartSessionResult {
  status: "created" | "exists";
  goal: string;
  answered: number;
  total: number;
  exported: boolean;
  handsOn: HandsOn;
  levels: Record<AreaId, Level>;
  modelEnabled: boolean;
}

export interface QuestionView {
  status: "question";
  index: number;
  total: number;
  exported: boolean;
  hint?: string;
  draft?: string;
  selectedOptionId?: string;
  question: {
    id: string;
    area: AreaId;
    title: string;
    prompt: string;
    level: Level;
    recommendation: { optionId: string; label: string };
    options: Question["options"];
  };
}

export interface SubquestionView {
  status: "subquestion";
  index: number;
  total: number;
  step: number;
  stepTotal: number;
  questionId: string;
  prompt: string;
  options: Question["idk"]["subquestions"][number]["options"];
}

export interface ExplainView {
  status: "explain";
  index: number;
  total: number;
  questionId: string;
  title: string;
  explanation: string;
  level: Level;
  recommendation: { optionId: string; label: string };
  options: Question["options"];
  hint?: string;
  draft?: string;
  selectedOptionId?: string;
}

export interface ReadyView {
  status: "ready";
  total: number;
  answered: number;
  exported: boolean;
}

export type RecordResult =
  | { status: "recorded"; questionId: string; optionId: string; reason: string; remaining: number }
  | { status: "hint"; questionId: string; hint: string; reason: string }
  | { status: "subquestion"; questionId: string; step: number; stepTotal: number; prompt: string }
  | { status: "explain"; questionId: string; explanation: string; recommendation: { optionId: string; label: string } }
  | { status: "confirm"; questionId: string };

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
    return sessionStatus("exists", existing, sessionTree(flow, existing).length);
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
    ...sessionTracking(),
    modelEnabled: input.model ?? true,
  };
  writeSession(flow.projectRoot, session, flow.coachRoot);
  return sessionStatus("created", session, flow.tree.length);
}

export type NextView = QuestionView | SubquestionView | ExplainView | ReadyView;

export function nextQuestion(options: FlowOptions): NextView {
  const flow = resolveFlow(options);
  const session = requireSession(flow);
  const tree = sessionTree(flow, session);
  const current = currentQuestion(session, tree);
  if (!current) {
    return {
      status: "ready",
      total: tree.length,
      answered: session.answers.length,
      exported: session.exportedAt !== null,
    };
  }

  const subquestion = subquestionView(session, current, tree.length);
  if (subquestion) return subquestion;
  if (session.explainQuestionId === current.question.id) {
    return explainView(session, current, tree.length);
  }
  return questionView(session, current, tree.length);
}

export function recordAnswer(
  options: FlowOptions,
  input: { questionId: string; optionId: string; reason: string },
): RecordResult {
  const flow = resolveFlow(options);
  const session = requireSession(flow);
  const tree = sessionTree(flow, session);
  if (session.exportedAt) {
    throw new CoachError("This session is already exported. Start again with reset true to change a decision.");
  }

  const current = currentQuestion(session, tree);
  if (!current) {
    throw new CoachError("Every core question already has an answer.");
  }
  if (input.questionId !== current.question.id) {
    throw new CoachError(`The current question is "${current.question.id}", not "${input.questionId}".`);
  }
  if (input.optionId === IDK) {
    return beginIdk(flow, session, current.question);
  }
  if (session.idk?.questionId === current.question.id) {
    return answerSubquestion(flow, session, current.question, input.optionId);
  }
  if (input.reason.trim().length === 0) {
    throw new CoachError("A reason is required.");
  }

  const option = current.question.options.find((item) => item.id === input.optionId);
  if (!option) {
    throw new CoachError(`"${input.optionId}" is not an option for "${current.question.id}".`);
  }

  const retry = session.pending?.questionId === current.question.id && session.pending.attempts >= 1;
  if (!reasonMatches(current.question, option, input.reason) && !retry) {
    const hint = reasonHint(current.question, option);
    writeSession(flow.projectRoot, {
      ...session,
      pending: {
        questionId: current.question.id,
        optionId: option.id,
        attempts: 1,
        hint,
        draft: input.reason,
      },
    }, flow.coachRoot);
    return { status: "hint", questionId: current.question.id, hint, reason: input.reason };
  }

  const answer: Answer = {
    questionId: current.question.id,
    optionId: option.id,
    reason: input.reason,
    answeredAt: flow.clock().toISOString(),
  };
  let updated: Session = retry || !reasonMatches(current.question, option, input.reason)
    ? session
    : recordCleanPass(session, current.question.area);
  updated = {
    ...updated,
    answers: [...updated.answers, answer],
    pending: null,
    idk: null,
    explainQuestionId: null,
  };
  writeSession(flow.projectRoot, updated, flow.coachRoot);
  return {
    status: "recorded",
    questionId: answer.questionId,
    optionId: answer.optionId,
    reason: answer.reason,
    remaining: tree.length - updated.answers.length,
  };
}

export function exportDecisions(options: FlowOptions): ExportResult {
  const flow = resolveFlow(options);
  const session = requireSession(flow);
  const tree = sessionTree(flow, session);
  assertComplete(session, tree);
  const rendered = renderExport(session, tree);
  const paths = writeExport(flow.projectRoot, rendered);
  const exportedAt = flow.clock().toISOString();
  writeSession(flow.projectRoot, { ...session, exportedAt }, flow.coachRoot);
  return { ...paths, decisionCount: tree.length };
}

export interface AdditionsResult {
  addedOptions: number;
  addedQuestions: number;
  total: number;
}

export function addProjectQuestions(options: FlowOptions, input: unknown): AdditionsResult {
  const flow = resolveFlow(options);
  const session = requireSession(flow);
  if (!session.modelEnabled) {
    throw new CoachError("Project-specific questions are off for this session. The core tree still runs.");
  }
  if (session.exportedAt) {
    throw new CoachError("This session is already exported. Start again with reset true to change a decision.");
  }
  const before = session.additions;
  const additions = mergeAdditions(
    flow.tree,
    before,
    input,
    new Set(session.answers.map((answer) => answer.questionId)),
  );
  writeSession(flow.projectRoot, { ...session, additions }, flow.coachRoot);
  return {
    addedOptions: additions.options.length - before.options.length,
    addedQuestions: additions.questions.length - before.questions.length,
    total: sessionTree(flow, { ...session, additions }).length,
  };
}

export function formatNext(view: NextView): string {
  if (view.status === "ready") return formatReady(view);
  if (view.status === "subquestion") {
    const options = view.options.map((option) => `- ${option.label} (${option.id}): ${option.note}`).join("\n");
    return `Question ${view.index} of ${view.total} · step ${view.step} of ${view.stepTotal}\n${view.prompt}\n${options}`;
  }
  if (view.status === "explain") {
    return [
      view.hint ?? "",
      view.explanation,
      `Suggested: ${view.recommendation.label} (${view.recommendation.optionId}). Confirm with record_answer. This is not stored yet.`,
    ].filter((line) => line.length > 0).join("\n");
  }
  return formatQuestion(view);
}

export function formatQuestion(view: QuestionView): string {
  const lines = [
    view.hint ?? "",
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
  return lines.filter((line, index) => line.length > 0 || index > 0).join("\n");
}

export function formatReady(view: ReadyView): string {
  if (view.exported) {
    return `All ${view.total} core decisions are recorded and already exported.`;
  }
  return `All ${view.total} core decisions are recorded. Call export_decisions to write DECISIONS.md and PLAN.md.`;
}

export function formatAdditions(result: AdditionsResult): string {
  return `Added ${result.addedOptions} option(s) and ${result.addedQuestions} question(s). The session now has ${result.total} questions.`;
}

export function formatStart(result: StartSessionResult): string {
  const progress = `${result.answered} of ${result.total} decisions recorded.`;
  if (result.status === "exists") {
    return `A session already exists for "${result.goal}". ${progress} Pass reset true to replace it.`;
  }
  return `Started a session for "${result.goal}". ${progress} Call next_question.`;
}

export function formatRecord(result: RecordResult): string {
  if (result.status === "hint") {
    return `The reason was not stored.\n${result.hint}`;
  }
  if (result.status === "subquestion") {
    return `Smaller question ${result.step} of ${result.stepTotal}: ${result.prompt}`;
  }
  if (result.status === "explain") {
    return `${result.explanation}\nSuggested: ${result.recommendation.label} (${result.recommendation.optionId}). Confirm with record_answer. This is not stored yet.`;
  }
  if (result.status === "confirm") {
    return `The smaller questions for "${result.questionId}" are done. Record a real option and a reason. Nothing is stored yet.`;
  }
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

function questionView(session: Session, current: { question: Question; index: number }, total: number): QuestionView {
  const level = session.levels[current.question.area];
  const recommended = recommendedOption(current.question, level);
  const pending = session.pending?.questionId === current.question.id ? session.pending : undefined;
  return {
    status: "question",
    index: current.index + 1,
    total,
    exported: session.exportedAt !== null,
    hint: pending?.hint,
    draft: pending?.draft,
    selectedOptionId: pending?.optionId,
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

function explainRecommendation(question: Question, level: Level): { optionId: string; label: string } {
  const optionId = question.idk.subquestions.length === 0
    ? question.recommendation[level]
    : question.idk.explain.recommend;
  const option = question.options.find((item) => item.id === optionId);
  if (!option) throw new CoachError(`Question "${question.id}" explains an unknown option.`);
  return { optionId: option.id, label: option.label };
}

function explainView(session: Session, current: { question: Question; index: number }, total: number): ExplainView {
  const level = session.levels[current.question.area];
  const pending = session.pending?.questionId === current.question.id ? session.pending : undefined;
  return {
    status: "explain",
    index: current.index + 1,
    total,
    questionId: current.question.id,
    title: current.question.title,
    explanation: current.question.idk.explain.explanation,
    level,
    recommendation: explainRecommendation(current.question, level),
    options: current.question.options,
    hint: pending?.hint,
    draft: pending?.draft,
    selectedOptionId: pending?.optionId,
  };
}

function subquestionView(session: Session, current: { question: Question; index: number }, total: number): SubquestionView | null {
  if (session.idk?.questionId !== current.question.id) return null;
  const subquestion = current.question.idk.subquestions[session.idk.step];
  if (!subquestion) return null;
  return {
    status: "subquestion",
    index: current.index + 1,
    total,
    step: session.idk.step + 1,
    stepTotal: current.question.idk.subquestions.length,
    questionId: current.question.id,
    prompt: subquestion.prompt,
    options: subquestion.options,
  };
}

function beginIdk(flow: ResolvedFlow, session: Session, question: Question): RecordResult {
  const level = session.levels[question.area];
  const updated = {
    ...recordIdk(session, question.area, question.id),
    pending: null,
  };
  if (level === "beginner" && question.idk.subquestions.length > 0) {
    writeSession(flow.projectRoot, {
      ...updated,
      idk: { questionId: question.id, step: 0 },
      explainQuestionId: null,
    }, flow.coachRoot);
    const first = question.idk.subquestions[0];
    if (!first) throw new CoachError(`Question "${question.id}" has no smaller questions.`);
    return {
      status: "subquestion",
      questionId: question.id,
      step: 1,
      stepTotal: question.idk.subquestions.length,
      prompt: first.prompt,
    };
  }

  const recommendation = explainRecommendation(question, level);
  writeSession(flow.projectRoot, {
    ...updated,
    idk: null,
    explainQuestionId: question.id,
  }, flow.coachRoot);
  return {
    status: "explain",
    questionId: question.id,
    explanation: question.idk.explain.explanation,
    recommendation,
  };
}

function answerSubquestion(flow: ResolvedFlow, session: Session, question: Question, optionId: string): RecordResult {
  const cursor = session.idk;
  const subquestion = cursor ? question.idk.subquestions[cursor.step] : undefined;
  if (!cursor || !subquestion) {
    throw new CoachError(`Question "${question.id}" is not on a smaller question.`);
  }
  if (!subquestion.options.some((option) => option.id === optionId)) {
    throw new CoachError(`"${optionId}" is not an option for this smaller question.`);
  }
  const nextStep = cursor.step + 1;
  const following = question.idk.subquestions[nextStep];
  if (!following) {
    writeSession(flow.projectRoot, { ...session, idk: null }, flow.coachRoot);
    return { status: "confirm", questionId: question.id };
  }
  writeSession(flow.projectRoot, { ...session, idk: { questionId: question.id, step: nextStep } }, flow.coachRoot);
  return {
    status: "subquestion",
    questionId: question.id,
    step: nextStep + 1,
    stepTotal: question.idk.subquestions.length,
    prompt: following.prompt,
  };
}

function recommendedOption(question: Question, level: Level) {
  const recommended = question.options.find((option) => option.id === question.recommendation[level]);
  if (!recommended) {
    throw new CoachError(`Question "${question.id}" has no recommendation for ${level}.`);
  }
  return recommended;
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

function sessionTree(flow: ResolvedFlow, session: Session): readonly Question[] {
  return applyAdditions(flow.tree, session.additions);
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
    modelEnabled: session.modelEnabled,
  };
}
