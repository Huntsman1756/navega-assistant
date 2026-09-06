/**
 * Dictation page -- visible fallback for microphone permission recovery.
 *
 * Adapted from Hermes Browser Extension (MIT) voice-dictation.html/voice-dictation.js.
 * Commit: 64f2abe443dddee78313e3b18169474cbd0f4f95
 *
 * This page is opened via window.open() when the side panel's getUserMedia
 * call is blocked (permission denied or suppressed). The user explicitly
 * clicks the button to grant microphone access.
 */

/* ------------------------------------------------------------------ */
/*  State                                                             */
/* ------------------------------------------------------------------ */

let mediaRecorder: MediaRecorder | null = null;
let recordingStream: MediaStream | null = null;
let recordingChunks: Blob[] = [];
let isRecording = false;
let voiceTransitionInFlight = false;

/* ------------------------------------------------------------------ */
/*  DOM elements                                                      */
/* ------------------------------------------------------------------ */

const micBtn = document.getElementById("mic-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLElement;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function stopAllTracks(stream: MediaStream | null): void {
  stream?.getTracks?.().forEach((track) => track.stop());
}

const MIME_ORDER = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
];

function findSupportedMime(): string {
  for (const mime of MIME_ORDER) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "";
}

/**
 * Deliver the transcript back to the side panel via chrome.runtime.sendMessage.
 * Falls back to chrome.storage.session with TTL and consume-once semantics.
 */
async function deliverTranscript(text: string, ts: number): Promise<void> {
  // Attempt 1: direct message to side panel
  try {
    chrome.runtime.sendMessage({ type: "VOICE_TRANSCRIPT", text, ts }, () => {
      // Success -- do nothing; the callback is called even on error
    });
  } catch {
    // Silently proceed to fallback
  }

  // Attempt 2: storage session fallback
  const key = `_nav_voice_transcript_${ts}`;
  await chrome.storage.session.set({
    [key]: { text, ts, createdAt: Date.now() },
  });

  // Auto-close after delivery
  setTimeout(() => {
    try { window.close(); } catch { /* best effort */ }
  }, 500);
}

/* ------------------------------------------------------------------ */
/*  Main flow                                                         */
/* ------------------------------------------------------------------ */

async function startRecordingFlow(): Promise<void> {
  if (voiceTransitionInFlight) return;
  voiceTransitionInFlight = true;
  isRecording = false;

  micBtn.disabled = true;
  micBtn.textContent = "Iniciando...";
  setStatus("Solicitando acceso al microfono...");

  // Step 1: Request microphone permission via getUserMedia
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
    });
  } catch (err) {
    const errMsg =
      err instanceof DOMException &&
      (err.name === "NotAllowedError" || err.name === "NotFoundError" || err.name === "UnknownError")
        ? "Permiso del microfono denegado. Habilitalo en la configuracion del navegador."
        : "No se pudo acceder al microfono.";
    setStatus(errMsg);
    micBtn.disabled = false;
    micBtn.textContent = "Permitir y grabar";
    voiceTransitionInFlight = false;
    return;
  }

  recordingStream = stream;
  recordingChunks = [];

  // Step 2: Create MediaRecorder
  const selectedMime = findSupportedMime();
  try {
    mediaRecorder = new MediaRecorder(stream, selectedMime ? { mimeType: selectedMime } : undefined);
  } catch {
    setStatus("Tu navegador no soporta grabacion de audio.");
    stopAllTracks(stream);
    micBtn.disabled = false;
    micBtn.textContent = "Permitir y grabar";
    voiceTransitionInFlight = false;
    return;
  }

  setStatus("Escuchando... (espera a terminar y pulsa Detener)");
  micBtn.textContent = "Detener grabacion";
  micBtn.classList.add("recording");
  isRecording = true;

  mediaRecorder.ondataavailable = (event: BlobEvent): void => {
    if (event.data.size > 0) {
      recordingChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async (): Promise<void> => {
    const blob = new Blob(recordingChunks, { type: recordingChunks[0]?.type ?? "audio/webm" });
    recordingChunks = [];
    stopAllTracks(recordingStream);
    recordingStream = null;
    mediaRecorder = null;
    isRecording = false;

    if (blob.size === 0) {
      setStatus("No se grabo audio. Cierra esta pestana e intentalo de nuevo.");
      micBtn.disabled = false;
      micBtn.textContent = "Permitir y grabar";
      micBtn.classList.remove("recording");
      voiceTransitionInFlight = false;
      return;
    }

    setStatus("Transcribiendo...");

    // Step 3: Send audio to NaN Whisper
    const sttForm = new FormData();
    sttForm.append("file", blob, "recording.webm");
    sttForm.append("language", "es");

    try {
      const res = await fetch("http://localhost:3456/v1/transcribe", {
        method: "POST",
        body: sttForm,
        signal: AbortSignal.timeout(65000),
      });

      if (!res.ok) {
        setStatus("No se pudo transcribir. Cierra esta pestana e intentalo de nuevo.");
        micBtn.disabled = false;
        micBtn.textContent = "Permitir y grabar";
        micBtn.classList.remove("recording");
        voiceTransitionInFlight = false;
        return;
      }

      const data = await res.json().catch(() => null);
      if (!data || typeof data.text !== "string" || data.text.trim().length === 0) {
        setStatus("Transcripcion vacia. Cierra esta pestana e intentalo de nuevo.");
        micBtn.disabled = false;
        micBtn.textContent = "Permitir y grabar";
        micBtn.classList.remove("recording");
        voiceTransitionInFlight = false;
        return;
      }

      const ttlTs = Date.now();
      setStatus(`Transcrito: "${data.text}"`);
      micBtn.disabled = false;
      micBtn.textContent = "Permitir y grabar";
      micBtn.classList.remove("recording");

      await deliverTranscript(data.text, ttlTs);
    } catch {
      setStatus("No se pudo transcribir. Cierra esta pestana e intentalo de nuevo.");
      micBtn.disabled = false;
      micBtn.textContent = "Permitir y grabar";
      micBtn.classList.remove("recording");
      voiceTransitionInFlight = false;
    }
  };

  // Start recording
  mediaRecorder.start(1000); // collect 1s chunks
  micBtn.disabled = false;
  voiceTransitionInFlight = false;
}

async function stopRecordingFlow(): Promise<void> {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  isRecording = false;
  micBtn.disabled = true;
  micBtn.textContent = "Deteniendo...";
}

micBtn.addEventListener("click", () => {
  if (isRecording) {
    void stopRecordingFlow();
  } else {
    void startRecordingFlow();
  }
});

// Cleanup on page hide
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAllTracks(recordingStream);
    recordingStream = null;
    mediaRecorder = null;
    isRecording = false;
    voiceTransitionInFlight = false;
  }
});