import { describe, it, expect, vi, afterEach } from "vitest";
import { MockProvider } from "@guided-web/provider";
import { createApp, MAX_TRANSCRIBE_BODY_BYTES } from "./routes";

const TTS_ENDPOINT = "https://nan.test/v1/audio/speech";
const STT_ENDPOINT = "https://nan.test/v1/audio/transcriptions";
const API_KEY = "nan-test-key";

function makeApp() {
  return createApp(new MockProvider(), "mock", "mock", {
    providerTimeoutMs: 5000,
    nanConfig: { ttsEndpoint: TTS_ENDPOINT, sttEndpoint: STT_ENDPOINT, apiKey: API_KEY },
  });
}

function speechRequest(body: unknown) {
  return makeApp().request("/v1/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function transcribeRequest(form: FormData) {
  return makeApp().request("/v1/transcribe", { method: "POST", body: form });
}

function audioFile(name = "a.webm", bytes = 3) {
  return new File([new Uint8Array(bytes)], name);
}

describe("POST /v1/speech", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns audio for the ef_dora voice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await speechRequest({ text: "hola", voice: "ef_dora" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect((await res.arrayBuffer()).byteLength).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(TTS_ENDPOINT);
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "audio/*",
    });
    expect(JSON.parse(init?.body as string)).toEqual({ model: "kokoro", input: "hola", voice: "ef_dora" });
  });

  it("returns audio for the em_alex voice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([4, 5]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await speechRequest({ text: "buenos días", voice: "em_alex" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(init?.body as string)).toEqual({ model: "kokoro", input: "buenos días", voice: "em_alex" });
  });

  it("rejects an unknown voice with 400 and does not call NaN", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await speechRequest({ text: "hola", voice: "bogus" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_voice" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty text with 400 and does not call NaN", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await speechRequest({ text: "", voice: "ef_dora" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only text with 400 and does not call NaN", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await speechRequest({ text: "   ", voice: "ef_dora" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects text longer than 500 chars with 400 and does not call NaN", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await speechRequest({ text: "a".repeat(501), voice: "ef_dora" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "text_too_long" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a safe error and never leaks the NaN error when NaN fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nan-secret-tts-error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await speechRequest({ text: "hola", voice: "ef_dora" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "speech_unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when ttsEndpoint is not configured", async () => {
    const app = createApp(new MockProvider(), "mock", "mock", {
      providerTimeoutMs: 5000,
      nanConfig: { apiKey: API_KEY },
    });
    const res = await app.request("/v1/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hola", voice: "ef_dora" }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "speech_unavailable" });
  });

  it("rejects request with extra fields", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await speechRequest({ text: "hola", voice: "ef_dora", extra: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /v1/transcribe", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the transcription for a valid file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "hola mundo" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("file", audioFile());
    form.append("language", "es");
    const res = await transcribeRequest(form);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "hola mundo" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(STT_ENDPOINT);
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
    const sent = init?.body as FormData;
    expect(sent.get("model")).toBe("whisper");
    expect(sent.get("language")).toBe("es");
    expect(sent.get("file")).toBeInstanceOf(File);
  });

  it("defaults language to es when omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "hola" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("file", audioFile());
    const res = await transcribeRequest(form);
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init?.body as FormData).get("language")).toBe("es");
  });

  it("rejects a missing file with 400 and does not call NaN", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("language", "es");
    const res = await transcribeRequest(form);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_file" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized file with 413 before calling NaN", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("file", new File([new Uint8Array(MAX_TRANSCRIBE_BODY_BYTES + 1)], "big.webm"));
    const res = await transcribeRequest(form);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "audio_too_large" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a safe error and never leaks the NaN error when NaN fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nan-secret-stt-error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("file", audioFile());
    const res = await transcribeRequest(form);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "transcribe_unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when sttEndpoint is not configured", async () => {
    const app = createApp(new MockProvider(), "mock", "mock", {
      providerTimeoutMs: 5000,
      nanConfig: { apiKey: API_KEY },
    });
    const form = new FormData();
    form.append("file", audioFile());
    const res = await app.request("/v1/transcribe", { method: "POST", body: form });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "transcribe_unavailable" });
  });
});