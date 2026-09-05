/**
 * Shared protocol for Guided Web Assistant.
 *
 * This package contains the strict, versioned schemas that flow between the
 * browser extension and the self-hostable backend, plus the P0 assistant
 * decision vocabulary.
 *
 * IMPORTANT: These schemas are strict. Unknown fields are rejected. They are
 * the primary structural boundary that keeps untrusted model/page output from
 * being interpreted as anything other than the intended protocol.
 */
import { z } from "zod";

/** Version of the wire protocol. Bump on breaking schema changes. */
export const PROTOCOL_VERSION = 3 as const;

/** Context capture mode. The operator, not the model, chooses the mode in P0. */
export const ContextModeSchema = z.enum(["DOM_ONLY", "DOM_PLUS_VISION"]);
export type ContextMode = z.infer<typeof ContextModeSchema>;

export const ContextModes: readonly ContextMode[] = ["DOM_ONLY", "DOM_PLUS_VISION"];

export const ElementStateSchema = z
  .object({
    disabled: z.boolean().optional(),
    checked: z.boolean().optional(),
    expanded: z.boolean().optional(),
    selected: z.boolean().optional(),
    empty: z.boolean().optional(),
    focused: z.boolean().optional(),
  })
  .strict();
export type ElementState = z.infer<typeof ElementStateSchema>;

/**
 * A single sanitized element within an AccessibleDOMSnapshot.
 *
 * P0 element `id` values are diagnostic identifiers only. They are NOT stable
 * across rerenders. P1 introduces robust target identity.
 */
export const AccessibleElementSchema = z
  .object({
    id: z.string().max(64),
    tag: z.string().max(64),
    role: z.string().max(64).optional(),
    accessibleName: z.string().max(160).optional(),
    interactive: z.boolean(),
    state: ElementStateSchema.optional(),
  })
  .strict();
export type AccessibleElement = z.infer<typeof AccessibleElementSchema>;

/**
 * Compact DOM-derived page representation.
 *
 * This is NOT the browser's native Accessibility Tree. It is derived from the
 * DOM, semantic HTML, roles, ARIA attributes, accessible-name calculation,
 * visible text, interactive elements and element states.
 */
export const AccessibleDOMSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotId: z.string().max(64),
    page: z
      .object({
        url: z.string().max(1000),
        origin: z.string().max(1000),
        title: z.string().max(300),
      })
      .strict(),
    elements: z.array(AccessibleElementSchema).max(200),
    visibleText: z.array(z.string().max(300)).max(40).optional(),
    truncated: z.boolean().optional(),
  })
  .strict();
export type AccessibleDOMSnapshot = z.infer<typeof AccessibleDOMSnapshotSchema>;

/**
 * One frame in the tab's document tree during the CURRENT help request.
 *
 * Every frame is its own independent document context. A frame either produced
 * a sanitized `snapshot`, or is explicitly `accessible: false` with a
 * `unavailableReason`. An inaccessible frame is NEVER silently represented as
 * an empty snapshot: the model must be able to tell that content is unavailable
 * rather than absent.
 *
 * `origin` is the frame's own origin (not the top page's) and is kept explicit
 * so the model reasons about which origin a control comes from.
 */
export const FrameSnapshotSchema = z
  .object({
    frameId: z.number().int().nonnegative(),
    // The main/top frame reports parentFrameId = -1 (Chrome convention); child
    // frames report their parent's frameId.
    parentFrameId: z.number().int().optional(),
    origin: z.string().max(1000).optional(),
    accessible: z.boolean(),
    snapshot: AccessibleDOMSnapshotSchema.optional(),
    unavailableReason: z.string().max(100).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.accessible && !val.snapshot) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an accessible frame must carry a snapshot" });
    }
    if (!val.accessible && val.snapshot) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an unavailable frame must not carry an empty snapshot (use unavailableReason)",
      });
    }
  });
export type FrameSnapshot = z.infer<typeof FrameSnapshotSchema>;

/**
 * The whole current page as a set of independent, sanitized frame contexts.
 *
 * - `topFrameId` always identifies the top-level (main) document.
 * - `frames` is bounded (the extractor enforces a total frame budget).
 * - The representation is intentionally versioned and NOT flattened: an iframe's
 *   content is never merged into the parent document snapshot.
 */
export const PageContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    topFrameId: z.number().int().nonnegative(),
    frames: z.array(FrameSnapshotSchema).max(8),
    truncated: z.boolean().optional(),
  })
  .strict()
  .refine(context => JSON.stringify(context).length <= 16000, "serialized context exceeds 16000 UTF-16 code units")
  .refine(context => context.frames.reduce((n, f) => n + (f.snapshot?.elements.length ?? 0), 0) <= 220, "too many total context elements");
export type PageContext = z.infer<typeof PageContextSchema>;

/**
 * P0 assistant decision. The only kinds of output P0 may produce.
 *
 * - explain: a single, actionable instruction/explanation.
 * - ask_user: a clarifying question to the user.
 * - cannot_help: safe degradation when context is insufficient.
 */
export const P0AssistantDecisionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("explain"),
      message: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ask_user"),
      message: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("cannot_help"),
      reason: z.string().trim().min(1).max(200),
      message: z.string().trim().min(1).max(4000),
    })
    .strict(),
]);
export type P0AssistantDecision = z.infer<typeof P0AssistantDecisionSchema>;

/**
 * A single turn in the current help conversation.
 *
 * The conversation is a bounded narrative of the CURRENT help task only. It is
 * NOT browsing history. Turns never carry page snapshots, and a turn text may
 * never contain secret values (the extension sanitizes before appending).
 */
export const HelpTurnSchema = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("user"),
      text: z.string().trim().min(1).max(4000),
      timestamp: z.number(),
    })
    .strict(),
  z
    .object({
      role: z.literal("assistant"),
      text: z.string().trim().min(1).max(4000),
      timestamp: z.number(),
    })
    .strict(),
]);
export type HelpTurn = z.infer<typeof HelpTurnSchema>;

/**
 * Versioned, ephemeral session-scoped help context.
 *
 * - Belongs to the current help task, NOT to browser history.
 * - `turns` are bounded (the extension trims deterministically).
 * - `currentOrigin` mirrors the most recent page origin; the authoritative
 *   current page is ALWAYS the fresh `snapshot` in the request.
 * - No page snapshot, no secrets, no full page contents are ever stored here.
 */
export const HelpSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: z.string().min(1).max(64),
    goal: z.string().max(4000).optional(),
    currentOrigin: z.string().max(2000).optional(),
    turns: z.array(HelpTurnSchema).max(10),
  })
  .strict();
export type HelpSession = z.infer<typeof HelpSessionSchema>;

/**
 * Request from extension to backend.
 *
 * Carries the whole current page as a bounded set of frame contexts (`context`).
 * A frame-aware assistant reasons about the current page WITHOUT pretending the
 * top-level document represents the whole page.
 */
export const AssistRequestSchema = z
  .object({
    protocolVersion: z.literal(3),
    mode: ContextModeSchema,
    question: z.string().min(1).max(2000),
    context: PageContextSchema,
    session: HelpSessionSchema,
  })
  .strict();
export type AssistRequest = z.infer<typeof AssistRequestSchema>;

/** Response from backend to extension. */
export const AssistResponseSchema = z
  .object({
    protocolVersion: z.literal(3),
    decision: P0AssistantDecisionSchema,
    mode: ContextModeSchema,
    provider: z.string().max(100).optional(),
    model: z.string().max(100).optional(),
  })
  .strict();
export type AssistResponse = z.infer<typeof AssistResponseSchema>;

/** Versioned semantic guidance vocabulary (future protocol, not executed in P0). */
export const GuidanceVerbV1Schema = z.enum([
  "press",
  "enter",
  "find",
  "read",
  "select",
  "enable",
  "disable",
  "open",
  "close",
  "scroll",
]);
export type GuidanceVerbV1 = z.infer<typeof GuidanceVerbV1Schema>;

export const GuidanceActionSchema = z
  .object({
    vocabularyVersion: z.literal(1),
    verb: GuidanceVerbV1Schema,
    targetId: z.string().optional(),
  })
  .strict();
export type GuidanceAction = z.infer<typeof GuidanceActionSchema>;
