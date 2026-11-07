import type { Option, Question } from "./types.js";

export function reasonMatches(question: Question, option: Option, reason: string): boolean {
  const chosen = mentions(reason, option.label);
  const namesAnother = question.options.some((item) => item.id !== option.id && mentions(reason, item.label));
  return !(namesAnother && !chosen);
}

export function reasonHint(question: Question, option: Option): string {
  const rubric = question.whyRubric.join("; ");
  return `That reason names a different option than ${option.label}. A sound reason: ${rubric}. Try once more. The next try is stored word for word.`;
}

function mentions(reason: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(reason);
}
