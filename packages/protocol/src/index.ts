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
export const PROTOCOL_VERSION = 1 as const;

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
    id: z.string(),
    tag: z.string(),
    role: z.string().optional(),
    accessibleName: z.string().optional(),
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
    snapshotId: z.string(),
    page: z
      .object({
        url: z.string(),
        origin: z.string(),
        title: z.string(),
      })
      .strict(),
    elements: z.array(AccessibleElementSchema),
    visibleText: z.array(z.string()).optional(),
  })
  .strict();
export type AccessibleDOMSnapshot = z.infer<typeof AccessibleDOMSnapshotSchema>;

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
      message: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ask_user"),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("cannot_help"),
      reason: z.string(),
      message: z.string(),
    })
    .strict(),
]);
export type P0AssistantDecision = z.infer<typeof P0AssistantDecisionSchema>;

/** Request from extension to backend. */
export const AssistRequestSchema = z
  .object({
    protocolVersion: z.literal(1),
    mode: ContextModeSchema,
    question: z.string().min(1).max(2000),
    snapshot: AccessibleDOMSnapshotSchema,
  })
  .strict();
export type AssistRequest = z.infer<typeof AssistRequestSchema>;

/** Response from backend to extension. */
export const AssistResponseSchema = z
  .object({
    protocolVersion: z.literal(1),
    decision: P0AssistantDecisionSchema,
    mode: ContextModeSchema,
    provider: z.string().optional(),
    model: z.string().optional(),
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
