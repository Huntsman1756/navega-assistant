/**
 * Deterministic relevance ranking and context budgeting.
 *
 * Purpose: the old extractor truncated by plain DOM order, so a relevant
 * control late in a long page (DOM index #275) could be missed even when it is
 * exactly what the user asked about. We therefore rank candidates with plain
 * browser/page semantics BEFORE any truncation. This is NOT semantic vector
 * search: no embeddings, no model, no RAG. It is a conservative, auditable,
 * deterministic ordering that favours visible, interactive, state-different
 * content and down-ranks repeated boilerplate.
 *
 * The exact numeric scores below are an implementation detail. What matters is
 * the documented ordering tier, determinism, and that the result is independent
 * of the model and of any external call.
 */

import type { ElementState } from "@guided-web/protocol";

/** The settings that bound a single snapshot. Frames add their own budget on top. */
export interface BudgetSettings {
  maxElements?: number;
  maxVisibleText?: number;
  maxTotalCharacters?: number;
}

export const DEFAULT_BUDGETS: Required<BudgetSettings> = {
  maxElements: 200,
  maxVisibleText: 40,
  maxTotalCharacters: 12000,
};

/** Everything the scorer needs to know about one candidate element. */
export interface CandidateAnalysis {
  domIndex: number;
  tag: string;
  role?: string;
  accessibleName?: string;
  interactive: boolean;
  state?: ElementState;
  visible: boolean;
  headingLevel: number; // 0 when not a heading
  isFocused: boolean;
  /** role alert/alertdialog, aria-live="assertive", or error-form-associated. */
  isAlertOrError: boolean;
  /** role dialog/alertdialog or aria-modal, or within a dialog. */
  isInDialog: boolean;
  /** selected/checked/expanded state present. */
  isStateful: boolean;
  /** landmark roles + the <nav>/<main>/<header> that are landmarks. */
  isLandmark: boolean;
  /** navigation controls (nav/role=navigation/link inside nav). */
  isNavigation: boolean;
  /** footer / contentinfo / known legal boilerplate. */
  isFooterLike: boolean;
  isFormField: boolean;
  /**
   * Text used to collapse repeated boilerplate. Falls back to the accessible
   * name; when a control has no useful name, the element's own text is used so
   * repeated footers/nav are still recognised as duplicates.
   */
  dedupeText?: string;
}

const TIER_INTERACTIVE = 700;
const TIER_ALERT = 900;
const TIER_FOCUSED = 1000;
const TIER_FORM_FIELD = 650;
const TIER_STATEFUL = 600;
const TIER_LANDMARK = 500;
const TIER_NAVIGATION = 300;
const TIER_SECTION_HEADING = 250;
const TIER_COMPACT_TEXT = 150;
const DEDUPE_PENALTY = 400;
const FOOTER_PENALTY = 200;

function tierFor(c: CandidateAnalysis): number {
  // Focused / alert / dialog are highest: they are what the user is looking at.
  if (c.isFocused) return TIER_FOCUSED;
  if (c.isAlertOrError || c.isInDialog) return TIER_ALERT;
  if (c.interactive) {
    // Plain navigation / list links are MEDIUM priority even though they are
    // technically interactive: primary action buttons must outrank page chrome
    // so a real control late in a long page still wins a fixed budget.
    return c.isNavigation ? TIER_NAVIGATION : TIER_INTERACTIVE;
  }
  if (c.isFormField) return TIER_FORM_FIELD;
  if (c.isStateful) return TIER_STATEFUL;
  if (c.headingLevel >= 1 && c.headingLevel <= 3) return TIER_LANDMARK;
  if (c.isLandmark) return TIER_LANDMARK;
  if (c.isNavigation) return TIER_NAVIGATION;
  if (c.headingLevel >= 4) return TIER_SECTION_HEADING;
  return TIER_COMPACT_TEXT;
}

/** Compute a deterministic relevance score for a single candidate. */
export function scoreCandidate(c: CandidateAnalysis): number {
  if (!c.visible) return -5000;
  let score = tierFor(c);
  if (c.isFooterLike) score -= FOOTER_PENALTY;
  // Boilerplate / repeated navigation is already at a low tier; dedupe below
  // separates the first occurrence from its repeats.
  return score;
}

/** A dedupe key collapses repeated boilerplate so duplicates do not crowd out novel UI. */
export function dedupeKey(c: CandidateAnalysis): string {
  const name = (c.dedupeText || c.accessibleName || "").trim().toLowerCase();
  const role = (c.role ?? c.tag).toLowerCase();
  return name ? `${role}::${name}` : "";
}

export interface RankedCandidate {
  analysis: CandidateAnalysis;
  score: number;
}

/**
 * Order candidates deterministically by relevance, applying the duplicate
 * penalty, keeping at most `maxPerGroup` members of any repeated boilerplate
 * group, and then trimming to `maxElements`. Ties break by DOM order (earlier
 * first), keeping the ordering stable for identical input.
 */
export function orderCandidates(
  candidates: CandidateAnalysis[],
  maxElements: number,
  maxPerGroup = 2,
): RankedCandidate[] {
  const firstSeen = new Map<string, number>();
  const ranked: RankedCandidate[] = candidates.map((analysis) => {
    let score = scoreCandidate(analysis);
    const key = dedupeKey(analysis);
    if (key) {
      const count = firstSeen.get(key);
      if (count === undefined) {
        firstSeen.set(key, 0);
      } else {
        // Repeated name+role (typical nav/footer/boilerplate) loses priority.
        firstSeen.set(key, count + 1);
        score -= DEDUPE_PENALTY * (count + 1);
      }
    }
    return { analysis, score };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.analysis.domIndex - b.analysis.domIndex;
  });

  // Keep only a small subset of any repeated boilerplate group so duplicated
  // navigation/footer cannot crowd out novel UI, while still allowing a useful
  // subset (e.g. two occurrences of a repeated list item).
  const emittedCount = new Map<string, number>();
  const out: RankedCandidate[] = [];
  for (const r of ranked) {
    const key = dedupeKey(r.analysis);
    if (key) {
      const n = emittedCount.get(key) ?? 0;
      if (n >= maxPerGroup) continue;
      emittedCount.set(key, n + 1);
    }
    out.push(r);
    if (out.length >= maxElements) break;
  }
  return out;
}

/**
 * Apply the character budget to an already ordered list of element records.
 * Trims from the END (lowest priority) until the total serialized size is under
 * `maxTotalCharacters`. Deterministic for identical input.
 */
export function applyCharacterBudget(
  ordered: RankedCandidate[],
  maxTotalCharacters: number,
  charOf: (c: CandidateAnalysis) => number,
): RankedCandidate[] {
  let total = 0;
  const out: RankedCandidate[] = [];
  for (const r of ordered) {
    const cost = charOf(r.analysis);
    if (total + cost > maxTotalCharacters && out.length > 0) break;
    total += cost;
    out.push(r);
  }
  return out;
}
