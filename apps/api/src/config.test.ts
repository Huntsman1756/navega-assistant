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
