import { CoachError } from "../errors.js";
import { exportDecisions, nextQuestion, recordAnswer, startSession, type FlowOptions } from "../flow.js";

export interface CardDeps extends FlowOptions {}

export type CardMessage =
  | { type: "start"; goal: string }
  | { type: "answer"; questionId: string; optionId: string; reason: string }
  | { type: "export" };

export interface CardOption {
  id: string;
  label: string;
  pros: string;
  cons: string;
  suggested: boolean;
}

export type CardState = {
  progress: string;
  error?: string;
} & (
  | { kind: "start"; goal: string }
  | {
    kind: "question";
    questionId: string;
    title: string;
    prompt: string;
    suggestion: string;
    options: CardOption[];
    selectedOptionId: string;
    reason: string;
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
      error: errorText(error),
    };
  }
}

export function applyCardMessage(deps: CardDeps, message: CardMessage): CardState {
  try {
    if (message.type === "start") {
      startSession(deps, { goal: message.goal });
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
    return { type: "start", goal: message.goal };
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
      return { kind: "start", progress: "No session yet", goal: "" };
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
    selectedOptionId: "",
    reason: "",
  };
}

function withDraft(state: CardState, message: CardMessage, error: string): CardState {
  if (state.kind === "start" && message.type === "start") {
    return { ...state, error, goal: message.goal };
  }
  if (state.kind === "question" && message.type === "answer") {
    return { ...state, error, selectedOptionId: message.optionId, reason: message.reason };
  }
  return { ...state, error };
}

function errorText(error: unknown): string {
  if (error instanceof CoachError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected coach error.";
}
