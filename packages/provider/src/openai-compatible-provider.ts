import type { AIProvider, AssistModelRequest, AssistModelResponse } from "./types";
import { ProviderConnectionError, ProviderHttpError, ProviderOutputError } from "./errors";

// qwen3.6 needs more than the initial 512-token trial to finish its reasoning
// and emit the small structured answer. 4096 is the smallest tested bound
// that leaves enough reasoning headroom for a complete response.
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export interface OpenAICompatibleOptions {
  /** Base URL of an OpenAI-compatible API, e.g. https://api.nan.builders/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Request JSON response format when the endpoint supports it. Default true. */
  jsonMode?: boolean;
}

/**
 * Provider for any OpenAI-compatible `/chat/completions` endpoint.
 *
 * This is also how nan.builders is configured: it is NOT hard-coded here.
 * nan.builders is simply pointed to via `AI_BASE_URL` / `AI_MODEL`.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name = "openai-compatible";

  constructor(private readonly opts: OpenAICompatibleOptions) {}

  async assist(request: AssistModelRequest, signal?: AbortSignal): Promise<AssistModelResponse> {
    const baseUrl = this.opts.baseUrl.replace(/\/+$/, "");
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: this.buildUserContent(request) },
      ],
      temperature: 0,
      max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    };

    if (this.opts.jsonMode !== false) {
      body.response_format = { type: "json_object" };
    }

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      // Preserve AbortError so the attempt deadline/caller cancellation can
      // classify it without confusing it with a connection failure.
      if (signal?.aborted) throw error;
      throw new ProviderConnectionError(error);
    }

    if (!res.ok) {
      // Consume the body to release the connection, but never retain or expose
      // upstream error text. The backend only needs the status and Retry-After.
      await res.text().catch(() => "");
      throw new ProviderHttpError(res.status, parseRetryAfterMs(res.headers.get("Retry-After")));
    }

    let data: { choices?: Array<{ message?: { content?: unknown } }> };
    try {
      data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    } catch {
      throw new ProviderOutputError();
    }

    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new ProviderOutputError();
    }

    return { raw, provider: this.name, model: this.opts.model };
  }

  private buildUserContent(request: AssistModelRequest): string {
    return JSON.stringify({
      mode: request.mode,
      question: request.question,
      session: request.session,
      context: request.context,
    });
  }
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds * 1000)) : undefined;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}
