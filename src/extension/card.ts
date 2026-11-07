import { CoachError } from "../errors.js";
import { exportDecisions, nextQuestion, recordAnswer, startSession, type FlowOptions } from "../flow.js";
import { AREAS, LEVELS, type AreaId, type Level } from "../types.js";

export interface CardDeps extends FlowOptions {}

export type CardMessage =
  | { type: "start"; goal: string; levels?: Partial<Record<AreaId, Level>> }
  | { type: "answer"; questionId: string; optionId: string; reason: string }
  | { type: "idk"; questionId: string }
  | { type: "export" };

export interface CardOption {
  id: string;
  label: string;
  pros: string;
  cons: string;
  suggested: boolean;
}

export interface CardSuboption {
  id: string;
  label: string;
  note: string;
}

export type CardState = {
  progress: string;
  error?: string;
} & (
  | { kind: "start"; goal: string; levels: Record<AreaId, Level> }
  | {
    kind: "question";
    questionId: string;
    title: string;
    prompt: string;
    suggestion: string;
    options: CardOption[];
    selectedOptionId: string;
    reason: string;
    hint?: string;
  }
  | {
    kind: "subquestion";
    questionId: string;
    prompt: string;
    options: CardSuboption[];
  }
  | {
    kind: "explain";
    questionId: string;
    title: string;
    explanation: string;
    suggestion: string;
    options: CardOption[];
    selectedOptionId: string;
    reason: string;
    hint?: string;
  }
  | { kind: "ready"; exported: boolean }
);

export function cardState(deps: CardDeps): CardState {
  try {
    return readCard(deps);
  } catch (error) {
    return {
      kind: "start",
      progress: "Cannot open this folder",
      goal: "",
      levels: defaultLevels(),
      error: errorText(error),
    };
  }
}

export function applyCardMessage(deps: CardDeps, message: CardMessage): CardState {
  try {
    if (message.type === "start") {
      startSession(deps, { goal: message.goal, levels: message.levels });
    } else if (message.type === "idk") {
      recordAnswer(deps, { questionId: message.questionId, optionId: "idk", reason: "" });
    } else if (message.type === "answer") {
      recordAnswer(deps, message);
    } else {
      exportDecisions(deps);
    }
    return cardState(deps);
  } catch (error) {
    return withDraft(cardState(deps), message, errorText(error));
  }
}

export function parseCardMessage(value: unknown): CardMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.type === "start" && typeof message.goal === "string") {
    return { type: "start", goal: message.goal, levels: parseLevels(message.levels) };
  }
  if (message.type === "idk" && typeof message.questionId === "string") {
    return { type: "idk", questionId: message.questionId };
  }
  if (message.type === "export") return { type: "export" };
  if (
    message.type === "answer"
    && typeof message.questionId === "string"
    && typeof message.optionId === "string"
    && typeof message.reason === "string"
  ) {
    return {
      type: "answer",
      questionId: message.questionId,
      optionId: message.optionId,
      reason: message.reason,
    };
  }
  return null;
}

function readCard(deps: CardDeps): CardState {
  let view;
  try {
    view = nextQuestion(deps);
  } catch (error) {
    if (error instanceof CoachError && error.message.startsWith("No session")) {
      return { kind: "start", progress: "No session yet", goal: "", levels: defaultLevels() };
    }
    throw error;
  }

  if (view.status === "ready") {
    return {
      kind: "ready",
      progress: `${view.answered} of ${view.total} recorded`,
      exported: view.exported,
    };
  }

  if (view.status === "subquestion") {
    return {
      kind: "subquestion",
      progress: `Question ${view.index} of ${view.total} · step ${view.step} of ${view.stepTotal}`,
      questionId: view.questionId,
      prompt: view.prompt,
      options: view.options,
    };
  }

  if (view.status === "explain") {
    return {
      kind: "explain",
      progress: `Question ${view.index} of ${view.total}`,
      questionId: view.questionId,
      title: view.title,
      explanation: view.explanation,
      suggestion: `Suggested: ${view.recommendation.label}. Confirm it, or pick another option.`,
      options: view.options.map((option) => ({
        id: option.id,
        label: option.label,
        pros: option.pros.join(" "),
        cons: option.cons.join(" "),
        suggested: option.id === view.recommendation.optionId,
      })),
      selectedOptionId: view.selectedOptionId ?? "",
      reason: view.draft ?? "",
      hint: view.hint,
    };
  }

  return {
    kind: "question",
    progress: `Question ${view.index} of ${view.total}`,
    questionId: view.question.id,
    title: view.question.title,
    prompt: view.question.prompt,
    suggestion: `Suggested for ${view.question.level}: ${view.question.recommendation.label}. This stays a suggestion until you record a choice.`,
    options: view.question.options.map((option) => ({
      id: option.id,
      label: option.label,
      pros: option.pros.join(" "),
      cons: option.cons.join(" "),
      suggested: option.id === view.question.recommendation.optionId,
    })),
    selectedOptionId: view.selectedOptionId ?? "",
    reason: view.draft ?? "",
    hint: view.hint,
  };
}

function withDraft(state: CardState, message: CardMessage, error: string): CardState {
  if (state.kind === "start" && message.type === "start") {
    return { ...state, error, goal: message.goal, levels: { ...state.levels, ...message.levels } };
  }
  if ((state.kind === "question" || state.kind === "explain") && message.type === "answer") {
    return { ...state, error, selectedOptionId: message.optionId, reason: message.reason };
  }
  return { ...state, error };
}

function defaultLevels(): Record<AreaId, Level> {
  return {
    stack: "intermediate",
    database: "intermediate",
    api: "intermediate",
    auth: "intermediate",
    deploy: "intermediate",
  };
}

function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

function parseLevels(value: unknown): Partial<Record<AreaId, Level>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const levels: Partial<Record<AreaId, Level>> = {};
  for (const area of AREAS) {
    const level = record[area];
    if (isLevel(level)) levels[area] = level;
  }
  return levels;
}

function errorText(error: unknown): string {
  if (error instanceof CoachError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected coach error.";
}
