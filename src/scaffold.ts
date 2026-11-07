import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as z from "zod/v4";
import { applyAdditions } from "./additions.js";
import { CoachError } from "./errors.js";
import type { FlowOptions } from "./flow.js";
import { readSession, resolveProjectRoot } from "./session.js";
import { loadCoreTree } from "./tree.js";
import type { Question, Session } from "./types.js";

const MARKER_PREFIX = "TODO(learn-coach:";

const manifestSchema = z.strictObject({
  version: z.literal(1),
  todos: z.array(z.strictObject({
    questionId: z.string().min(1),
    file: z.string().min(1),
    functionName: z.string().min(1),
    marker: z.string().min(1),
  })),
});

type StackLanguage = "node" | "python" | "go";

export interface PlannedTodo {
  questionId: string;
  title: string;
  choice: string;
  optionId: string;
  reason: string;
  file: string;
  functionName: string;
  marker: string;
  language: StackLanguage;
}

export interface ScaffoldResult {
  todoCount: number;
  written: string[];
  kept: string[];
}

export interface ReviewResult {
  status: "open" | "ready";
  questionId: string;
  title: string;
  choice: string;
  optionId: string;
  reason: string;
  whyRubric: string[];
  file: string;
  functionName: string;
  source: string;
}

export function planTodos(session: Session, tree: readonly Question[]): PlannedTodo[] {
  const language = stackLanguage(session, tree);
  return tree.map((question) => {
    const answer = session.answers.find((item) => item.questionId === question.id);
    if (!answer) throw new CoachError(`Cannot scaffold before "${question.id}" has an answer.`);
    const option = question.options.find((item) => item.id === answer.optionId);
    if (!option) throw new CoachError(`Answer for "${question.id}" names an unknown option.`);
    const marker = `${MARKER_PREFIX}${question.id})`;
    return {
      questionId: question.id,
      title: question.title,
      choice: option.label,
      optionId: option.id,
      reason: answer.reason,
      file: `src/${question.id}.${extension(language)}`,
      functionName: functionName(question.id, language),
      marker,
      language,
    };
  });
}

export function renderStub(todo: PlannedTodo, step: number): string {
  const header = comment(todo.language, [
    `Decision ${step}: ${todo.title}`,
    `Choice: ${todo.choice} (\`${todo.optionId}\`)`,
    "Reason:",
    ...todo.reason.split(/\r?\n/),
  ]);
  if (todo.language === "python") {
    return `${header}\ndef ${todo.functionName}() -> None:\n    raise NotImplementedError("${todo.marker}")\n`;
  }
  if (todo.language === "go") {
    return `package praxis\n\n${header}\nfunc ${todo.functionName}() {\n\tpanic("${todo.marker}")\n}\n`;
  }
  return `${header}\nexport function ${todo.functionName}(): void {\n  throw new Error("${todo.marker}");\n}\n`;
}

export function scaffoldTodos(options: FlowOptions): ScaffoldResult {
  const loaded = loadExported(options);
  if (loaded.session.handsOn !== "todos") {
    throw new CoachError("Full generation is not available. This session only scaffolds marked TODOs.");
  }
  const todos = planTodos(loaded.session, loaded.tree);
  const written: string[] = [];
  const kept: string[] = [];
  for (const [index, todo] of todos.entries()) {
    const absolute = insideProject(loaded.root, todo.file);
    const existing = existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
    if (existing !== undefined && !existing.includes(todo.marker)) {
      kept.push(todo.file);
      continue;
    }
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, renderStub(todo, index + 1), "utf8");
    written.push(todo.file);
  }
  const manifest = {
    version: 1 as const,
    todos: todos.map(({ questionId, file, functionName, marker }) => ({ questionId, file, functionName, marker })),
  };
  const manifestPath = path.join(loaded.root, ".learn-coach", "todos.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { todoCount: todos.length, written, kept };
}

export function reviewTodo(options: FlowOptions, questionId: string): ReviewResult {
  const loaded = loadExported(options);
  const manifest = readManifest(loaded.root);
  const todo = manifest.todos.find((item) => item.questionId === questionId);
  if (!todo) throw new CoachError(`No TODO for "${questionId}".`);
  const absolute = insideProject(loaded.root, todo.file);
  let source: string;
  try {
    source = readFileSync(absolute, "utf8");
  } catch {
    throw new CoachError(`TODO file is missing: ${todo.file}`);
  }
  const question = loaded.tree.find((item) => item.id === questionId);
  const answer = loaded.session.answers.find((item) => item.questionId === questionId);
  if (!question || !answer) throw new CoachError(`No decision is stored for "${questionId}".`);
  const option = question.options.find((item) => item.id === answer.optionId);
  if (!option) throw new CoachError(`Answer for "${questionId}" names an unknown option.`);
  return {
    status: source.includes(todo.marker) ? "open" : "ready",
    questionId,
    title: question.title,
    choice: option.label,
    optionId: option.id,
    reason: answer.reason,
    whyRubric: [...question.whyRubric],
    file: todo.file,
    functionName: todo.functionName,
    source,
  };
}

export function formatScaffold(result: ScaffoldResult): string {
  const kept = result.kept.length > 0 ? ` Left ${result.kept.length} student file(s) in place.` : "";
  return `Wrote ${result.written.length} of ${result.todoCount} TODO stub(s). The student writes each marked function.${kept}`;
}

export function formatReview(result: ReviewResult): string {
  const decision = `Decision: ${result.title}. Choice: ${result.choice} (${result.optionId}). Reason: ${result.reason}`;
  if (result.status === "open") {
    return `${result.file} still has the TODO marker. The student has not written ${result.functionName}. ${decision}`;
  }
  const rubric = result.whyRubric.join("; ");
  return `Review ${result.functionName} in ${result.file} against this decision. ${decision} A sound reason: ${rubric}. Do not rewrite the function.`;
}

function loadExported(options: FlowOptions): { root: string; session: Session; tree: Question[] } {
  const root = resolveProjectRoot(options.projectRoot, options.coachRoot);
  const session = readSession(root, options.coachRoot);
  if (!session) throw new CoachError("No session in this project. Call start_session first.");
  if (!session.exportedAt) throw new CoachError("Export the decisions before scaffolding TODOs.");
  const tree = applyAdditions(options.tree ?? loadCoreTree(), session.additions);
  return { root, session, tree };
}

function readManifest(root: string): z.infer<typeof manifestSchema> {
  const file = path.join(root, ".learn-coach", "todos.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new CoachError("No TODO manifest. Call scaffold_todos after export.");
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    throw new CoachError(`TODO manifest is not valid JSON: ${file}`);
  }
  const parsed = manifestSchema.safeParse(document);
  if (!parsed.success) throw new CoachError(`TODO manifest is invalid: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

function stackLanguage(session: Session, tree: readonly Question[]): StackLanguage {
  const question = tree.find((item) => item.id === "stack" || item.area === "stack");
  const answer = question ? session.answers.find((item) => item.questionId === question.id) : undefined;
  if (answer?.optionId === "python" || answer?.optionId === "go") return answer.optionId;
  return "node";
}

function extension(language: StackLanguage): string {
  if (language === "python") return "py";
  if (language === "go") return "go";
  return "ts";
}

function functionName(id: string, language: StackLanguage): string {
  const parts = id.split("-").filter((part) => part.length > 0);
  if (language === "python") return `implement_${parts.join("_")}`;
  const pascal = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  return language === "go" ? `Implement${pascal}` : `implement${pascal}`;
}

function comment(language: StackLanguage, lines: string[]): string {
  const prefix = language === "python" ? "# " : "// ";
  return lines.map((line) => `${prefix}${line}`.trimEnd()).join("\n");
}

function insideProject(root: string, relative: string): string {
  if (path.isAbsolute(relative)) throw new CoachError(`TODO path escapes the project: ${relative}`);
  const absolute = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (absolute !== root && !absolute.startsWith(prefix)) {
    throw new CoachError(`TODO path escapes the project: ${relative}`);
  }
  return absolute;
}
