import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CoachError } from "./errors.js";
import { packageRoot } from "./paths.js";
import { fillTemplate } from "./template.js";
import type { Question, Session } from "./types.js";

const HANDS_ON_COPY = {
  todos: "todos. After export, scaffold_todos writes one stub function per decision. The student writes that function.",
  full: "full. Full generation is stored for later and this export does not generate code.",
} as const;

export interface RenderedExport {
  decisions: string;
  plan: string;
}

export function renderExport(session: Session, tree: readonly Question[]): RenderedExport {
  const entries = tree.map((question, index) => {
    const answer = session.answers.find((item) => item.questionId === question.id);
    if (!answer) {
      throw new CoachError(`Cannot export before "${question.id}" has an answer.`);
    }
    const option = question.options.find((item) => item.id === answer.optionId);
    if (!option) {
      throw new CoachError(`Answer for "${question.id}" names an unknown option.`);
    }
    return fillTemplate(readTemplate("decision-entry.md"), {
      number: String(index + 1),
      title: question.title,
      prompt: question.prompt,
      options: formatOptions(question),
      choice: `${option.label} (\`${option.id}\`)`,
      reason: answer.reason,
      date: formatDecisionDate(answer.answeredAt),
    });
  });

  const steps = tree.map((question, index) => {
    const answer = session.answers.find((item) => item.questionId === question.id);
    const option = question.options.find((item) => item.id === answer?.optionId);
    if (!answer || !option) {
      throw new CoachError(`Cannot export before "${question.id}" has an answer.`);
    }
    return fillTemplate(readTemplate("plan-step.md"), {
      number: String(index + 1),
      title: question.title,
      choice: `${option.label} (\`${option.id}\`)`,
      reason: answer.reason,
    });
  });

  return {
    decisions: fillTemplate(readTemplate("decisions.md"), {
      goal: session.goal,
      entries: entries.join("\n\n"),
    }),
    plan: fillTemplate(readTemplate("plan.md"), {
      goal: session.goal,
      handsOn: HANDS_ON_COPY[session.handsOn],
      steps: steps.join("\n\n"),
    }),
  };
}

export function writeExport(projectRoot: string, rendered: RenderedExport): { decisionsPath: string; planPath: string } {
  const decisionsPath = path.join(projectRoot, "DECISIONS.md");
  const planPath = path.join(projectRoot, "PLAN.md");
  writeFileSync(decisionsPath, rendered.decisions, "utf8");
  writeFileSync(planPath, rendered.plan, "utf8");
  return { decisionsPath, planPath };
}

export function formatDecisionDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function formatOptions(question: Question): string {
  return question.options.map((option) => {
    return `- ${option.label} (\`${option.id}\`). Pros: ${option.pros.join(" ")} Cons: ${option.cons.join(" ")}`;
  }).join("\n");
}

function readTemplate(name: string): string {
  return readFileSync(path.join(packageRoot(), "templates", name), "utf8");
}
