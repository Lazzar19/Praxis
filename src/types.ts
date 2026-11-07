export const AREAS = ["stack", "database", "api", "auth", "deploy"] as const;
export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const HANDS_ON = ["todos", "full"] as const;

export type AreaId = (typeof AREAS)[number];
export type Level = (typeof LEVELS)[number];
export type HandsOn = (typeof HANDS_ON)[number];
export type Clock = () => Date;

export interface Option {
  id: string;
  label: string;
  pros: string[];
  cons: string[];
}

export interface IdkOption {
  id: string;
  label: string;
  note: string;
}

export interface IdkSubquestion {
  id: string;
  prompt: string;
  options: IdkOption[];
}

export interface IdkExplain {
  explanation: string;
  recommend: string;
}

/** Beginners walk subquestions. Intermediate and advanced get explain, then confirm. */
export interface IdkPath {
  subquestions: IdkSubquestion[];
  explain: IdkExplain;
}

export interface Question {
  id: string;
  area: AreaId;
  title: string;
  prompt: string;
  options: Option[];
  recommendation: Record<Level, string>;
  whyRubric: string[];
  idk: IdkPath;
}

export interface Answer {
  questionId: string;
  optionId: string;
  reason: string;
  answeredAt: string;
}

export interface LevelCounts {
  idk: number;
  cleanPasses: number;
}

export interface PendingReason {
  questionId: string;
  optionId: string;
  attempts: number;
  hint: string;
  draft: string;
}

export interface IdkCursor {
  questionId: string;
  step: number;
}

export interface AddedOption {
  questionId: string;
  option: Option;
}

/** A project question has no authored lesson. The flow explains it, then waits for confirmation. */
export interface AddedQuestion {
  id: string;
  area: AreaId;
  title: string;
  prompt: string;
  options: Option[];
  recommendation: Record<Level, string>;
  whyRubric: string[];
}

export interface ProjectAdditions {
  options: AddedOption[];
  questions: AddedQuestion[];
}

export interface Session {
  version: 1;
  goal: string;
  levels: Record<AreaId, Level>;
  handsOn: HandsOn;
  answers: Answer[];
  startedAt: string;
  exportedAt: string | null;
  levelCounts: Record<AreaId, LevelCounts>;
  pending: PendingReason | null;
  idk: IdkCursor | null;
  idkSeen: string[];
  explainQuestionId: string | null;
  modelEnabled: boolean;
  additions: ProjectAdditions;
}

export function blankLevelCounts(): Record<AreaId, LevelCounts> {
  return {
    stack: { idk: 0, cleanPasses: 0 },
    database: { idk: 0, cleanPasses: 0 },
    api: { idk: 0, cleanPasses: 0 },
    auth: { idk: 0, cleanPasses: 0 },
    deploy: { idk: 0, cleanPasses: 0 },
  };
}

export function emptyAdditions(): ProjectAdditions {
  return { options: [], questions: [] };
}

export function sessionTracking(): Pick<Session, "levelCounts" | "pending" | "idk" | "idkSeen" | "explainQuestionId" | "modelEnabled" | "additions"> {
  return {
    levelCounts: blankLevelCounts(),
    pending: null,
    idk: null,
    idkSeen: [],
    explainQuestionId: null,
    modelEnabled: true,
    additions: emptyAdditions(),
  };
}
