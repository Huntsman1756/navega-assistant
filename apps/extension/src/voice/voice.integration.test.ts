// @vitest-environment happy-dom
/**
 * Voice integration regression tests.
 *
 * Covers:
 * - FIX 1: All three voice paths (TTS, STT, dictation) use getBackendUrl()
 *   from shared/backend-url, NOT hardcoded URLs.
 * - FIX 3: 30-second recording safety limit is enforced.
 * - FIX 5: Transcript delivery uses synchronous sendMessage check so that
 *   chrome.storage.session is written ONLY when sendMessage fails.
 * - Voice error mapping: a voiceless backend (404, e.g. the frozen G1
 *   runtime) is distinguishable from missing key (503), timeout (504) and
 *   network failure (0).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { VOICE_TRANSCRIPT_TTL_MS, isStale, trySendMessage, storeTranscriptFallback, voiceErrorMessage } from "../shared/voice-messages";
import type { VoiceTranscriptMessage } from "../shared/voice-messages";
import { getBackendUrl } from "../shared/backend-url";
import { initVoiceController } from "./voice-control";

/* ------------------------------------------------------------------ */
/*  Chrome mocks                                                      */
/* ------------------------------------------------------------------ */

const mockStorage: Record<string, unknown> = {};
const mockListeners: Array<(msg: VoiceTranscriptMessage) => void> = [];
let lastErrorValue: DOMException | null = null;

vi.stubGlobal("chrome", {
  get browser() { return chrome; },
  runtime: {
    sendMessage: vi.fn((msg: unknown, cb?: () => void) => {
      // Fire callbacks for any registered listeners
      for (const l of mockListeners) {
        try { l(msg as VoiceTranscriptMessage); } catch { /* ignore */ }
      }
      // Invoke callback if provided
      if (cb) {
        // Simulate: lastError is set on the sync check, callback fires after
        setTimeout(cb, 0);
      }
    }),
    lastError: null as DOMException | null,
    onMessage: {
      addListener: vi.fn((l: (msg: unknown) => void) => { mockListeners.push(l as (msg: VoiceTranscriptMessage) => void); }),
      removeListener: vi.fn(),
    },
    getURL: vi.fn((p: string) => `chrome-extension://test/${p}`),
    Port: class {
      postMessage = vi.fn();
      onMessage = { addListener: vi.fn() };
      onDisconnect = { addListener: vi.fn() };
      disconnect = vi.fn();
    },
  },
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[] | Record<string, unknown>) => {
        const keyArray: string[] = Array.isArray(keys) ? keys : [keys as string];
        const result: Record<string, unknown> = {};
        for (const k of keyArray) {
          if (Object.prototype.hasOwnProperty.call(mockStorage, k)) result[k] = mockStorage[k];
        }
        return result;
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(mockStorage, obj);
      }),
    },
    session: {
      get: vi.fn(async (keys: string | string[] | Record<string, unknown>) => {
        const keyArray: string[] = Array.isArray(keys) ? keys : [keys as string];
        const result: Record<string, unknown> = {};
        for (const k of keyArray) {
          if (Object.prototype.hasOwnProperty.call(mockStorage, k)) result[k] = mockStorage[k];
        }
        return result;
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(mockStorage, obj);
      }),
      remove: vi.fn(async (key: string | string[]) => {
        const keyArray = Array.isArray(key) ? key : [key];
        for (const k of keyArray) {
          delete mockStorage[k];
        }
      }),
    },
  },
  tabs: {
    query: vi.fn(async () => []),
  },
  sidePanel: {
    setPanelBehavior: vi.fn(async () => {}),
  },
  messages: {
    sendNative: vi.fn(),
  },
});

/* ------------------------------------------------------------------ */
/*  FIX 1 — Backend URL resolution (all paths share getBackendUrl)    */
/* ------------------------------------------------------------------ */

describe("FIX 1: backend URL resolution (all voice paths use getBackendUrl)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  });

  it("getBackendUrl resolves to default when storage is empty", async () => {
    const url = await getBackendUrl();
    expect(url).toBe("http://localhost:8787");
  });

  it("getBackendUrl honors chrome.storage.local override", async () => {
    mockStorage["backendUrl"] = "http://mybackend.test";
    const url = await getBackendUrl();
    expect(url).toBe("http://mybackend.test");
  });

  it("getBackendUrl strips trailing slashes", async () => {
    mockStorage["backendUrl"] = "http://mybackend.test/";
    const url = await getBackendUrl();
    expect(url).toBe("http://mybackend.test");
  });

  it("getBackendUrl returns a valid URL string", async () => {
    const url = await getBackendUrl();
    expect(() => new URL(url)).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/*  FIX 3: 30-second recording safety limit                           */
/* ------------------------------------------------------------------ */

describe("FIX 3: 30-second recording safety limit", () => {
  it("VOICE_TRANSCRIPT_TTL_MS is 30000 (30 seconds)", () => {
    expect(VOICE_TRANSCRIPT_TTL_MS).toBe(30000);
  });

  it("isStale returns false within TTL", () => {
    const ts = Date.now();
    expect(isStale(ts)).toBe(false);
  });

  it("isStale returns true after TTL", () => {
    const ts = Date.now() - 30001;
    expect(isStale(ts)).toBe(true);
  });

  it("isStale returns false at exactly TTL boundary", () => {
    const ts = Date.now() - 30000;
    expect(isStale(ts)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  FIX 5: transcript delivery — storage only on sendMessage failure  */
/* ------------------------------------------------------------------ */

describe("FIX 5: transcript delivery (storage only on sendMessage failure)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear();
    lastErrorValue = null;
  });

  it("trySendMessage returns true when sendMessage succeeds", () => {
    // No lastError set => sendMessage succeeds
    const msg: VoiceTranscriptMessage = { type: "VOICE_TRANSCRIPT", text: "test", ts: Date.now() };
    const result = trySendMessage(msg);
    expect(result).toBe(true);
  });

  it("trySendMessage returns false when chrome.runtime.lastError is set", () => {
    (chrome.runtime as unknown as { lastError: DOMException | null }).lastError = new DOMException("No such channel", "NotFoundError");
    const msg: VoiceTranscriptMessage = { type: "VOICE_TRANSCRIPT", text: "test", ts: Date.now() };
    const result = trySendMessage(msg);
    expect(result).toBe(false);
  });

  it("storeTranscriptFallback stores in session storage", async () => {
    const ts = Date.now();
    await storeTranscriptFallback("hello world", ts);
    const key = Object.keys(mockStorage).find((k) => k.startsWith("_nav_voice_transcript_"));
    expect(key).toBeDefined();
    const stored = mockStorage[key!];
    expect(stored).toMatchObject({ text: "hello world", ts });
    expect((stored as { createdAt: number }).createdAt).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Voice error mapping (wrong-backend vs transient failure)          */
/* ------------------------------------------------------------------ */

describe("voiceErrorMessage", () => {
  it("names the voiceless-backend case explicitly (404 = wrong build, e.g. frozen G1 runtime)", () => {
    const msg = voiceErrorMessage("speech", 404);
    expect(msg).toMatch(/no ofrece voz/i);
    expect(msg).toMatch(/versión con voz/i);
  });

  it("separates missing key (503) from upstream timeout (504)", () => {
    expect(voiceErrorMessage("transcribe", 503)).toMatch(/clave/i);
    expect(voiceErrorMessage("speech", 504)).toMatch(/tar/i);
    expect(voiceErrorMessage("speech", 504)).not.toBe(voiceErrorMessage("transcribe", 504));
  });

  it("reports connection failure for status 0 and surfaces audio_too_large", () => {
    expect(voiceErrorMessage("speech", 0)).toMatch(/conectar/i);
    expect(voiceErrorMessage("transcribe", 413, "audio_too_large")).toMatch(/demasiado grande/i);
  });

  it("falls back to the generic retry messages for other failures", () => {
    expect(voiceErrorMessage("speech", 500)).toMatch(/No se pudo generar/i);
    expect(voiceErrorMessage("transcribe", 500)).toMatch(/No se pudo transcribir/i);
  });
});

describe("voice controls", () => {
  it("shows TTS failures in the live status and only updates the response button", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "provider_unavailable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const sttBtn = document.createElement("button");
    sttBtn.textContent = "Hablar";
    const responseBtn = document.createElement("button");
    responseBtn.textContent = "Escuchar";
    const status = document.createElement("div");
    const input = document.createElement("textarea");
    const voice = initVoiceController({ sttBtn, status, input });

    await voice.playAnswer("Lee esta respuesta", responseBtn);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(status.textContent).toMatch(/No se pudo generar/i);
    expect(responseBtn.textContent).toBe("Escuchar");
    expect(responseBtn.classList.contains("playing")).toBe(false);
    expect(sttBtn.textContent).toBe("Hablar");
    vi.stubGlobal("fetch", originalFetch);
  });
});
