/**
 * Provider abstraction for Guided Web Assistant.
 *
 * The product is provider-independent. Providers only translate a normalized
 * model request into a raw model output string; they never decide policy.
 * Structural validation and instruction safety live in the backend, not here.
 */
import type { AccessibleDOMSnapshot, ContextMode, HelpSession } from "@guided-web/protocol";

export interface AssistModelRequest {
  mode: ContextMode;
  question: string;
  snapshot: AccessibleDOMSnapshot;
  /** Bounded recent help conversation (never a browsing history). */
  session: HelpSession;
  /** System prompt describing the task, untrusted-content and safety constraints. */
  systemPrompt: string;
}

/**
 * Raw model output. `raw` is the unparsed text returned by the model. It MUST
 * be parsed and validated by the caller before it is ever rendered or acted on.
 */
export interface AssistModelResponse {
  raw: string;
  provider: string;
  model?: string;
}

export interface VisionModelRequest {
  mode: ContextMode;
  question: string;
  snapshot: AccessibleDOMSnapshot;
  /** Raw screenshot bytes or data URL. P0 keeps this experimental. */
  image: string | Uint8Array;
  systemPrompt: string;
}

export interface VisionModelResponse {
  raw: string;
  provider: string;
  model?: string;
}

export interface AIProvider {
  readonly name: string;
  assist(request: AssistModelRequest, signal?: AbortSignal): Promise<AssistModelResponse>;
  vision?(request: VisionModelRequest, signal?: AbortSignal): Promise<VisionModelResponse>;
}
