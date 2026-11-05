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

/** Authored for slice 3. Slice 1 stores this and does not walk it. */
export interface IdkPath {
  subquestions: IdkSubquestion[];
  explain: IdkExplain;
}

export interface Question {
  id: AreaId;
  area: AreaId;
  title: string;
  prompt: string;
  options: Option[];
  recommendation: Record<Level, string>;
  whyRubric: string[];
  idk: IdkPath;
}

export interface Answer {
  questionId: AreaId;
  optionId: string;
  reason: string;
  answeredAt: string;
}

export interface Session {
  version: 1;
  goal: string;
  levels: Record<AreaId, Level>;
  handsOn: HandsOn;
  answers: Answer[];
  startedAt: string;
  exportedAt: string | null;
}
