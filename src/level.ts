import { LEVELS, type AreaId, type Level, type Session } from "./types.js";

export const LEVEL_STEP = 3;

export function stepLevel(level: Level, delta: -1 | 1): Level {
  const next = LEVELS.indexOf(level) + delta;
  if (next < 0) return "beginner";
  if (next > LEVELS.length - 1) return "advanced";
  return LEVELS[next] ?? level;
}

export function recordIdk(session: Session, area: AreaId, questionId: string): Session {
  if (session.idkSeen.includes(questionId)) return session;
  const counts = session.levelCounts[area];
  const idk = counts.idk + 1;
  const level = idk % LEVEL_STEP === 0 ? stepLevel(session.levels[area], -1) : session.levels[area];
  return {
    ...session,
    idkSeen: [...session.idkSeen, questionId],
    levels: { ...session.levels, [area]: level },
    levelCounts: { ...session.levelCounts, [area]: { ...counts, idk } },
  };
}

export function recordCleanPass(session: Session, area: AreaId): Session {
  const counts = session.levelCounts[area];
  const cleanPasses = counts.cleanPasses + 1;
  const level = cleanPasses % LEVEL_STEP === 0 ? stepLevel(session.levels[area], 1) : session.levels[area];
  return {
    ...session,
    levels: { ...session.levels, [area]: level },
    levelCounts: { ...session.levelCounts, [area]: { ...counts, cleanPasses } },
  };
}
