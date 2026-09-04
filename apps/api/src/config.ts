import type { AIProvider } from "@guided-web/provider";
import { MockProvider, OpenAICompatibleProvider } from "@guided-web/provider";

export interface ApiConfig {
  port: number;
  provider: AIProvider;
  providerName: string;
  model?: string;
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
        provider = new OpenAICompatibleProvider({ baseUrl, apiKey, model });
      }
      break;
    default:
      throw new Error(`Unknown AI_PROVIDER "${providerName}". Use "mock" or "openai-compatible".`);
  }

  const port = Number(env.PORT || 8787);
  return { port, provider, providerName, model };
}
