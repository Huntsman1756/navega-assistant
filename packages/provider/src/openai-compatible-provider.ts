import type { AIProvider, AssistModelRequest, AssistModelResponse } from "./types";

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
    };

    if (this.opts.jsonMode !== false) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Provider error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };

    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") {
      throw new Error("Provider returned no content");
    }

    return { raw, provider: this.name, model: this.opts.model };
  }

  private buildUserContent(request: AssistModelRequest): string {
    return JSON.stringify({
      mode: request.mode,
      question: request.question,
      session: request.session,
      snapshot: request.snapshot,
    });
  }
}
