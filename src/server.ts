import { readFileSync } from "node:fs";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CoachError } from "./errors.js";
import {
  addProjectQuestions,
  exportDecisions,
  formatAdditions,
  formatExport,
  formatNext,
  formatRecord,
  formatStart,
  nextQuestion,
  recordAnswer,
  startSession,
} from "./flow.js";
import { additionInputSchema } from "./additions.js";
import { packageRoot } from "./paths.js";
import type { Clock, Question } from "./types.js";
import { HANDS_ON, LEVELS } from "./types.js";

const levelSchema = z.enum(LEVELS);
const levelsSchema = z.strictObject({
  stack: levelSchema.optional(),
  database: levelSchema.optional(),
  api: levelSchema.optional(),
  auth: levelSchema.optional(),
  deploy: levelSchema.optional(),
});

const projectRootSchema = z.object({
  projectRoot: z.string().min(1).describe("Absolute or relative path of the student project. Not the learn-coach repo."),
});

export interface CoachServerOptions {
  clock?: Clock;
  tree?: readonly Question[];
  coachRoot?: string;
}

export function createCoachServer(options: CoachServerOptions = {}): McpServer {
  const server = new McpServer({ name: "learn-coach", version: packageVersion() });
  const flowOptions = (projectRoot: string) => ({
    projectRoot,
    clock: options.clock,
    tree: options.tree,
    coachRoot: options.coachRoot ?? packageRoot(),
  });

  server.registerTool(
    "start_session",
    {
      title: "Start session",
      description: "Start a Learn Coach session in a student project. Writes .learn-coach/session.json only. Ask the student to rate themselves beginner, intermediate, or advanced for stack, database, api, auth, and deploy, and pass those levels. Omitted areas stay intermediate. Pass reset true to replace an existing session. Pass model false to refuse project-specific additions and keep the five core decisions.",
      inputSchema: projectRootSchema.extend({
        goal: z.string().min(1).describe("What the student is building."),
        levels: levelsSchema.optional().describe("Self-rating per area. Omitted areas stay intermediate."),
        handsOn: z.enum(HANDS_ON).optional().describe("Recorded for later scaffolding. This version does not generate code."),
        reset: z.boolean().optional().describe("Replace the session already stored in this project."),
        model: z.boolean().optional().describe("When false, add_project_questions is refused and the core tree is the whole session."),
      }),
    },
    async ({ projectRoot, goal, levels, handsOn, reset, model }) => guard(() => {
      const result = startSession(flowOptions(projectRoot), { goal, levels, handsOn, reset, model });
      return { text: formatStart(result), data: result };
    }),
  );

  server.registerTool(
    "next_question",
    {
      title: "Next question",
      description: "Return the next unanswered decision, including pros, cons, and the recommendation for the student's level. The recommendation is not stored until record_answer. Project-specific questions, if add_project_questions stored any, come after the five core decisions. If the student does not know, record optionId idk: beginners then get authored sub-questions, and intermediate or advanced students get an explanation they must confirm. A project question has no authored lesson, so every level confirms the suggestion. Call export_decisions when status is ready.",
      inputSchema: projectRootSchema,
    },
    async ({ projectRoot }) => guard(() => {
      const result = nextQuestion(flowOptions(projectRoot));
      const text = formatNext(result);
      return { text, data: result };
    }),
  );

  server.registerTool(
    "record_answer",
    {
      title: "Record answer",
      description: "Store the student's choice and their own reason for the current question. questionId must be the question next_question just returned. optionId idk starts the I-don't-know branch and does not store a decision. A reason that names a different option is not stored; the tool returns one hint, and the next reason is stored word for word.",
      inputSchema: projectRootSchema.extend({
        questionId: z.string().min(1),
        optionId: z.string().min(1),
        reason: z.string().describe("The student's own words. Required except for optionId idk and sub-question answers."),
      }),
    },
    async ({ projectRoot, questionId, optionId, reason }) => guard(() => {
      const result = recordAnswer(flowOptions(projectRoot), { questionId, optionId, reason });
      return { text: formatRecord(result), data: result };
    }),
  );

  server.registerTool(
    "export_decisions",
    {
      title: "Export decisions",
      description: "Write DECISIONS.md and PLAN.md in the student project root from the session. Requires an answer for every question, including project-specific ones. Does not generate project code.",
      inputSchema: projectRootSchema,
    },
    async ({ projectRoot }) => guard(() => {
      const result = exportDecisions(flowOptions(projectRoot));
      return { text: formatExport(result), data: result };
    }),
  );

  server.registerTool(
    "add_project_questions",
    {
      title: "Add project questions",
      description: "Add options or questions that belong to this project and are not in the core tree. Send a fixed JSON object with options and questions. Do not send a lesson, sub-questions, or an explanation. A question needs id, area, title, prompt, two to four options (id, label, pros, cons), recommendation option ids for beginner, intermediate, and advanced, and whyRubric. An option names the questionId it attaches to. At most 3 questions per session and 2 extra options per question. Ids are short lowercase. If this call fails, the core tree is unchanged and the session can still finish.",
      inputSchema: projectRootSchema.extend(additionInputSchema.shape),
    },
    async ({ projectRoot, ...additions }) => guard(() => {
      const result = addProjectQuestions(flowOptions(projectRoot), additions);
      return { text: formatAdditions(result), data: result };
    }),
  );

  return server;
}

function guard(fn: () => { text: string; data: unknown }): CallToolResult {
  try {
    const result = fn();
    return {
      content: [{ type: "text", text: result.text }],
      structuredContent: result.data,
    };
  } catch (error) {
    if (!(error instanceof CoachError)) console.error(error);
    const message = error instanceof CoachError ? error.message : "Unexpected coach error.";
    return {
      isError: true,
      content: [{ type: "text", text: message }],
    };
  }
}

function packageVersion(): string {
  const parsed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
  return parsed.version ?? "0.0.0";
}
