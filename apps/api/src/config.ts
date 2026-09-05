import type { AIProvider } from "@guided-web/provider";
import { MockProvider, OpenAICompatibleProvider } from "@guided-web/provider";

/**
 * Hard deadline for a single provider call. The real-provider measurements
 * (qwen3.6, 20 samples) show p50 ~0.7 s and p95 ~1.7 s; the problem is the
 * heavy tail (observed max 11.5 s). 8000 ms is far above the healthy tail and
 * far below "indefinite". No automatic retry: a timed-out request fails as a
 * distinguishable `provider_timeout` and the USER decides whether to retry.
 */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 8000;
export const MIN_PROVIDER_TIMEOUT_MS = 1000;
export const MAX_PROVIDER_TIMEOUT_MS = 30000;

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
      `[config] invalid AI_PROVIDER_TIMEOUT_MS "${raw}" (expected an integer between ` +
        `${MIN_PROVIDER_TIMEOUT_MS} and ${MAX_PROVIDER_TIMEOUT_MS}); using default ${DEFAULT_PROVIDER_TIMEOUT_MS}`,
    );
    return DEFAULT_PROVIDER_TIMEOUT_MS;
  }
  return value;
}

export interface ApiConfig {
  port: number;
  provider: AIProvider;
  providerName: string;
  model?: string;
  /** Hard timeout (ms) on each provider call. Default 8000. */
  providerTimeoutMs: number;
}

/**
 * Loads provider and server configuration from the environment.
 *
 * The provider API key lives ONLY here, in backend configuration. It is never
 * sent to the browser extension.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const providerName = env.AI_PROVIDER || "mock";
  let provider: AIProvider;
  let model: string | undefined;

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
      }
      break;
    default:
      throw new Error(`Unknown AI_PROVIDER "${providerName}". Use "mock" or "openai-compatible".`);
  }

  const port = Number(env.PORT || 8787);
  const providerTimeoutMs = parseProviderTimeoutMs(env.AI_PROVIDER_TIMEOUT_MS);
  return { port, provider, providerName, model, providerTimeoutMs };
}
