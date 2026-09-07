import type { AIProvider } from "@guided-web/provider";
import { MockProvider, OpenAICompatibleProvider } from "@guided-web/provider";
import { OPERATOR_API_PORT } from "@guided-web/protocol";

export const MAX_PROVIDER_ATTEMPTS = 2;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15000;
export const MIN_PROVIDER_TIMEOUT_MS = 1000;
export const MAX_PROVIDER_TIMEOUT_MS = 30000;
export const DEFAULT_PROVIDER_TOTAL_BUDGET_MS = 18000;
export const MIN_PROVIDER_TOTAL_BUDGET_MS = 1000;
export const MAX_PROVIDER_TOTAL_BUDGET_MS = 18000;

/**
 * Hard deadline for a single provider call. The real-provider measurements
 * (qwen3.6, 20 samples) show p50 ~0.7 s and p95 ~1.7 s; the problem is the
 * heavy tail (observed max 11.5 s). The 15 s setting is a measured candidate
 * allocation: it covers the observed tail while one bounded retry remains
 * available inside the separate 18 s total-operation budget below.
 */
export const DEFAULT_NAN_BASE_URL = "https://api.nan.builders";

/**
 * Parses AI_PROVIDER_TIMEOUT_MS defensively. Anything that is not an integer
 * within [MIN, MAX] is treated as a misconfiguration: warn and fall back to
 * the default, so a bad .env can never disable the fail-fast deadline.
 */
export function parseProviderTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PROVIDER_TIMEOUT_MS;
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < MIN_PROVIDER_TIMEOUT_MS ||
    value > MAX_PROVIDER_TIMEOUT_MS
  ) {
    console.warn(
      `[config] invalid AI_PROVIDER_TIMEOUT_MS (expected an integer between ` +
        `${MIN_PROVIDER_TIMEOUT_MS} and ${MAX_PROVIDER_TIMEOUT_MS}); using default ${DEFAULT_PROVIDER_TIMEOUT_MS}`,
    );
    return DEFAULT_PROVIDER_TIMEOUT_MS;
  }
  return value;
}

/**
 * Parses the hard budget for the complete assist operation, including one
 * bounded retry and its delay. This budget is authoritative over per-attempt
 * timeouts and is intentionally capped below the extension fail-safe.
 */
export function parseProviderTotalBudgetMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PROVIDER_TOTAL_BUDGET_MS;
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < MIN_PROVIDER_TOTAL_BUDGET_MS ||
    value > MAX_PROVIDER_TOTAL_BUDGET_MS
  ) {
    console.warn(
      `[config] invalid AI_PROVIDER_TOTAL_TIMEOUT_MS (expected an integer between ` +
        `${MIN_PROVIDER_TOTAL_BUDGET_MS} and ${MAX_PROVIDER_TOTAL_BUDGET_MS}); ` +
        `using default ${DEFAULT_PROVIDER_TOTAL_BUDGET_MS}`,
    );
    return DEFAULT_PROVIDER_TOTAL_BUDGET_MS;
  }
  return value;
}

export interface ApiConfig {
  port: number;
  provider: AIProvider;
  providerName: string;
  model?: string;
  /** Hard timeout (ms) on each provider attempt. Default 15000. */
  providerTimeoutMs: number;
  /** Hard timeout (ms) for the complete assist operation. Default 18000. */
  providerTotalTimeoutMs: number;
  /** Derived NaN base URL (without /v1 suffix). */
  nanBaseUrl?: string;
  /** Kokoro TTS endpoint derived from nanBaseUrl. */
  ttsEndpoint?: string;
  /** Whisper STT endpoint derived from nanBaseUrl. */
  sttEndpoint?: string;
  /** API key for NaN speech endpoints. Reuses AI_API_KEY when AI_PROVIDER=openai-compatible. */
  nanApiKey?: string;
}

/**
 * Loads provider and server configuration from the environment.
 *
 * The provider API key lives ONLY here, in backend configuration. It is never
 * sent to the browser extension.
 *
 * NaN speech endpoints (Kokoro TTS / Whisper STT) reuse the same base URL and
 * API key that the LLM provider uses when pointing at nan.builders.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const providerName = env.AI_PROVIDER?.trim();
  if (!providerName) throw new Error("AI_PROVIDER must explicitly select mock or openai-compatible");
  let provider: AIProvider;
  let model: string | undefined;
  let nanBaseUrl: string | undefined;
  let nanApiKey: string | undefined;

  switch (providerName) {
    case "mock":
      provider = new MockProvider();
      break;
    case "openai-compatible":
      {
        const baseUrl = env.AI_BASE_URL;
        const apiKey = env.AI_API_KEY;
        model = env.AI_MODEL;
        if (!baseUrl || !apiKey || !model) {
          throw new Error(
            "AI_BASE_URL, AI_API_KEY and AI_MODEL are required when AI_PROVIDER=openai-compatible",
          );
        }
        const jsonMode = env.AI_JSON_MODE !== "0";
        provider = new OpenAICompatibleProvider({ baseUrl, apiKey, model, jsonMode });

        // When the LLM provider points at nan.builders, reuse the same base URL
        // and API key for speech endpoints (Kokoro + Whisper share the same key).
        const trimmedUrl = baseUrl.replace(/\/+$/, "");
        const isNanEndpoint = trimmedUrl.includes("nan.builders") || trimmedUrl.includes("nan.build");
        if (isNanEndpoint) {
          nanBaseUrl = trimmedUrl.replace(/\/v1$/, "");
          nanApiKey = apiKey;
        }
      }
      break;
    default:
      throw new Error('Unknown AI_PROVIDER. Use "mock" or "openai-compatible".');
  }

  const port = Number(env.PORT || OPERATOR_API_PORT);
  const providerTimeoutMs = parseProviderTimeoutMs(env.AI_PROVIDER_TIMEOUT_MS);
  const providerTotalTimeoutMs = parseProviderTotalBudgetMs(env.AI_PROVIDER_TOTAL_TIMEOUT_MS);

  // Allow optional explicit overrides (e.g. non-NaN openai-compatible provider).
  const finalNanBaseUrl = nanBaseUrl
    ?? env.NAN_BASE_URL?.trim()
    ?? undefined;
  const ttsEndpoint = env.NAVIGANA_TTS_ENDPOINT?.trim()
    || (finalNanBaseUrl ? `${finalNanBaseUrl}/v1/audio/speech` : undefined);
  const sttEndpoint = env.NAVIGANA_STT_ENDPOINT?.trim()
    || (finalNanBaseUrl ? `${finalNanBaseUrl}/v1/audio/transcriptions` : undefined);
  // If a dedicated key is not provided but we have nanBaseUrl, reuse nanApiKey.
  const finalNanApiKey = env.NAVIGANA_API_KEY?.trim() || nanApiKey;

  return {
    port,
    provider,
    providerName,
    model,
    providerTimeoutMs,
    providerTotalTimeoutMs,
    nanBaseUrl: finalNanBaseUrl,
    ttsEndpoint,
    sttEndpoint,
    nanApiKey: finalNanApiKey,
  };
}
