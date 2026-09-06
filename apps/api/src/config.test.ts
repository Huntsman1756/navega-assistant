import { describe, it, expect, vi, afterEach } from "vitest";
import {
  loadConfig,
  parseProviderTimeoutMs,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  MIN_PROVIDER_TIMEOUT_MS,
  MAX_PROVIDER_TIMEOUT_MS,
} from "./config";

describe("parseProviderTimeoutMs (AI_PROVIDER_TIMEOUT_MS)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("defaults to 8000 when unset or empty", () => {
    expect(parseProviderTimeoutMs(undefined)).toBe(8000);
    expect(parseProviderTimeoutMs("")).toBe(DEFAULT_PROVIDER_TIMEOUT_MS);
    expect(parseProviderTimeoutMs("   ")).toBe(DEFAULT_PROVIDER_TIMEOUT_MS);
    expect(DEFAULT_PROVIDER_TIMEOUT_MS).toBe(8000);
  });

  it("parses a valid configured value", () => {
    expect(parseProviderTimeoutMs("8000")).toBe(8000);
    expect(parseProviderTimeoutMs("12345")).toBe(12345);
    expect(parseProviderTimeoutMs(String(MIN_PROVIDER_TIMEOUT_MS))).toBe(MIN_PROVIDER_TIMEOUT_MS);
    expect(parseProviderTimeoutMs(String(MAX_PROVIDER_TIMEOUT_MS))).toBe(MAX_PROVIDER_TIMEOUT_MS);
  });

  it("falls back to the default for any invalid value (never disables the deadline)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = ["abc", "0", "-500", "99999999", "800.5", "Infinity", "NaN", "8s"];
    for (const value of bad) {
      expect(parseProviderTimeoutMs(value)).toBe(DEFAULT_PROVIDER_TIMEOUT_MS);
    }
    // Below the sensible minimum or above the maximum is rejected too.
    expect(parseProviderTimeoutMs(String(MIN_PROVIDER_TIMEOUT_MS - 1))).toBe(DEFAULT_PROVIDER_TIMEOUT_MS);
    expect(parseProviderTimeoutMs(String(MAX_PROVIDER_TIMEOUT_MS + 1))).toBe(DEFAULT_PROVIDER_TIMEOUT_MS);
    expect(warn).toHaveBeenCalled();
  });
});

describe("loadConfig provider timeout wiring", () => {
  it("passes the configured timeout through to the app config", () => {
    const cfg = loadConfig({ AI_PROVIDER: "mock", AI_PROVIDER_TIMEOUT_MS: "9000" });
    expect(cfg.providerTimeoutMs).toBe(9000);
  });

  it("uses the default timeout when the env value is missing or invalid", () => {
    expect(loadConfig({ AI_PROVIDER: "mock" }).providerTimeoutMs).toBe(DEFAULT_PROVIDER_TIMEOUT_MS);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadConfig({ AI_PROVIDER: "mock", AI_PROVIDER_TIMEOUT_MS: "nope" }).providerTimeoutMs).toBe(
      DEFAULT_PROVIDER_TIMEOUT_MS,
    );
    warn.mockRestore();
  });
});

it("rejects missing or incomplete real-provider configuration explicitly", () => {
  expect(() => loadConfig({})).toThrow("AI_PROVIDER must explicitly");
  expect(() => loadConfig({ AI_PROVIDER: "openai-compatible" })).toThrow("are required");
});

it("normal startup cannot silently run mock provider — mock requires explicit AI_PROVIDER=mock", () => {
  // Without AI_PROVIDER set → startup fails (not silent mock).
  expect(() => loadConfig({})).toThrow("AI_PROVIDER must explicitly");
  // With only partial env → startup fails (not silent mock).
  expect(() => loadConfig({ PORT: "9999" })).toThrow("AI_PROVIDER must explicitly");
  // Mock requires explicit opt-in.
  const cfg = loadConfig({ AI_PROVIDER: "mock" });
  expect(cfg.providerName).toBe("mock");
  // openai-compatible requires full config.
  const real = loadConfig({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://x.com", AI_API_KEY: "k", AI_MODEL: "m" });
  expect(real.providerName).toBe("openai-compatible");
});

describe("NaN speech endpoint derivation and API key reuse", () => {
  it("derives speech endpoints and reuses AI_API_KEY when AI_BASE_URL points at nan.builders", () => {
    const cfg = loadConfig({
      AI_PROVIDER: "openai-compatible",
      AI_BASE_URL: "https://api.nan.builders/v1",
      AI_API_KEY: "sk-secret-123",
      AI_MODEL: "qwen3.6",
    });
    expect(cfg.nanBaseUrl).toBe("https://api.nan.builders");
    expect(cfg.ttsEndpoint).toBe("https://api.nan.builders/v1/audio/speech");
    expect(cfg.sttEndpoint).toBe("https://api.nan.builders/v1/audio/transcriptions");
    expect(cfg.nanApiKey).toBe("sk-secret-123");
  });

  it("derives speech endpoints from nan.baseurl with trailing slash", () => {
    const cfg = loadConfig({
      AI_PROVIDER: "openai-compatible",
      AI_BASE_URL: "https://api.nan.builders/v1/",
      AI_API_KEY: "sk-secret-456",
      AI_MODEL: "gemma4",
    });
    expect(cfg.nanBaseUrl).toBe("https://api.nan.builders");
    expect(cfg.ttsEndpoint).toBe("https://api.nan.builders/v1/audio/speech");
    expect(cfg.sttEndpoint).toBe("https://api.nan.builders/v1/audio/transcriptions");
    expect(cfg.nanApiKey).toBe("sk-secret-456");
  });

  it("mock provider has no speech endpoints or key", () => {
    const cfg = loadConfig({ AI_PROVIDER: "mock" });
    expect(cfg.ttsEndpoint).toBeUndefined();
    expect(cfg.sttEndpoint).toBeUndefined();
    expect(cfg.nanApiKey).toBeUndefined();
    expect(cfg.nanBaseUrl).toBeUndefined();
  });

  it("non-nan openai-compatible provider does not derive speech endpoints", () => {
    const cfg = loadConfig({
      AI_PROVIDER: "openai-compatible",
      AI_BASE_URL: "https://other.provider.com/v1",
      AI_API_KEY: "sk-other",
      AI_MODEL: "other-model",
    });
    expect(cfg.ttsEndpoint).toBeUndefined();
    expect(cfg.sttEndpoint).toBeUndefined();
    expect(cfg.nanApiKey).toBeUndefined();
    expect(cfg.nanBaseUrl).toBeUndefined();
  });

  it("explicit NAVIGANA_API_KEY overrides the reused key", () => {
    const cfg = loadConfig({
      AI_PROVIDER: "openai-compatible",
      AI_BASE_URL: "https://api.nan.builders/v1",
      AI_API_KEY: "sk-main-123",
      AI_MODEL: "qwen3.6",
      NAVIGANA_API_KEY: "sk-speech-only",
    });
    expect(cfg.nanApiKey).toBe("sk-speech-only");
  });
});
