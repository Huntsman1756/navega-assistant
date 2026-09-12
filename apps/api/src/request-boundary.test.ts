import { afterEach, describe, expect, it, vi } from "vitest";
import { MockProvider, type AIProvider } from "@guided-web/provider";
import { createApp } from "./routes";

const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnop";
const FOREIGN_ORIGIN = "https://attacker.example";

function appWithProvider(provider: AIProvider = new MockProvider()) {
  return createApp(provider, provider.name, "mock", {
    nanConfig: {
      ttsEndpoint: "https://speech.test/v1/audio/speech",
      sttEndpoint: "https://speech.test/v1/audio/transcriptions",
      apiKey: "test-key",
    },
  });
}

describe("loopback request boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["/v1/assist", "application/json", "{}"],
    ["/v1/speech", "application/json", "{}"],
    ["/v1/transcribe", "multipart/form-data; boundary=test", "--test--\r\n"],
  ])("rejects a website origin before handling %s", async (path, contentType, body) => {
    const provider: AIProvider = {
      name: "must-not-run",
      assist: vi.fn(() => Promise.reject(new Error("must not run"))),
    };
    const upstreamFetch = vi.fn(() => Promise.reject(new Error("must not run")));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await appWithProvider(provider).request(path, {
      method: "POST",
      headers: { Origin: FOREIGN_ORIGIN, "Content-Type": contentType },
      body,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden_origin" });
    expect(provider.assist).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["/v1/assist", "text/plain", "{}"],
    ["/v1/speech", "text/plain", "{}"],
    ["/v1/transcribe", "application/json", "{}"],
  ])("rejects the wrong media type for %s", async (path, contentType, body) => {
    const response = await appWithProvider().request(path, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({ error: "unsupported_media_type" });
  });

  it("allows the Chromium extension origin to use a JSON endpoint", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await appWithProvider().request("/v1/speech", {
      method: "POST",
      headers: { Origin: EXTENSION_ORIGIN, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ text: "hola", voice: "ef_dora" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("keeps origin-less local clients compatible", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await appWithProvider().request("/v1/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hola", voice: "ef_dora" }),
    });

    expect(response.status).toBe(200);
  });
});
