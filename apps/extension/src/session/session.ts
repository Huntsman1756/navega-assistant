/**
 * Pure session logic for the current help task.
 *
 * This module is deliberately chrome-free so it can be unit-tested. It models a
 * small, bounded, EPHEMERAL conversation about the current help task — NOT a
 * browsing history and NOT a behavioural profile.
 *
 * Guarantees:
 * - `turns` are bounded (deterministic trim keeps the most recent N).
 * - no page snapshot is ever stored inside a turn or the session;
 * - user-typed secret-looking values are redacted before retention;
 * - resetting creates a fresh session.
 */
import { HelpSessionSchema, type HelpSession, type HelpTurn } from "@guided-web/protocol";
import { redactSecretValues } from "@guided-web/security-policy";

/** Maximum number of recent turns retained in a session. */
export const MAX_TURNS = 10;
/** Hard cap on a single turn's text length. */
export const MAX_TURN_TEXT = 4000;
/** Soft cap on the goal length (kept short; it is a hint, not a log). */
export const MAX_GOAL_TEXT = 200;

function makeSessionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Create a fresh, empty help session. */
export function createSession(): HelpSession {
  return { schemaVersion: 1, sessionId: makeSessionId(), turns: [] };
}

/** Reset the current help task, returning a brand-new session. */
export function resetSession(): HelpSession {
  return createSession();
}

/** Record the overarching goal of the current help task (hint only). */
export function setGoal(session: HelpSession, goal: string): HelpSession {
  const trimmed = goal.trim().slice(0, MAX_GOAL_TEXT);
  return { ...session, goal: trimmed.length > 0 ? trimmed : undefined };
}

/** Record the most recent page origin (mirror of the fresh snapshot). */
export function setCurrentOrigin(session: HelpSession, origin: string): HelpSession {
  const trimmed = origin.trim();
  return { ...session, currentOrigin: trimmed.length > 0 ? trimmed : undefined };
}

/**
 * Append a turn and return the new session.
 *
 * For user turns the text is passed through the secret redaction policy first,
 * so a secret that a user accidentally pastes into the question box is never
 * retained verbatim. The goal is captured from the first user turn only.
 */
export function appendTurn(
  session: HelpSession,
  role: HelpTurn["role"],
  rawText: string,
): HelpSession {
  const text = redactSecretValues(rawText);
  const trimmed = text.trim().slice(0, MAX_TURN_TEXT);
  if (!trimmed) throw new Error("empty session turn");
  const turn: HelpTurn = { role, text: trimmed, timestamp: Date.now() };
  const turns = trimTurns([...session.turns, turn], MAX_TURNS);
  let goal = session.goal;
  if (!goal && role === "user") {
    goal = trimmed.slice(0, MAX_GOAL_TEXT);
  }
  return HelpSessionSchema.parse({ ...session, goal, turns });
}

/**
 * Deterministically keep only the most recent `max` turns.
 *
 * This guarantees the prompt cannot grow without bound regardless of how long a
 * help task lasts. Trimming is deterministic (last-N), so tests are stable.
 */
export function trimTurns(turns: HelpTurn[], max = MAX_TURNS): HelpTurn[] {
  return turns.length > max ? turns.slice(turns.length - max) : turns;
}
