/**
 * Conversation UI controller for the side panel.
 *
 * The side panel is the authoritative live UX state for the current help task.
 * This module is chrome-API-agnostic: it receives a narrow `facade` so it can be
 * unit-tested with a fake. It manages a small bounded conversation, drives
 * per-origin permission UX, and never performs any autonomous browser action.
 */
import type { AccessibleDOMSnapshot, HelpSession, HelpTurn, PageContext } from "@guided-web/protocol";
import type { AssistResultMessage } from "../shared/messages";
import { capturePageContext } from "./capture";
import {
  appendTurn,
  resetSession,
  setCurrentOrigin,
} from "../session/session";
import { classifyPage, originMatchPattern, displayOrigin } from "../permissions/permissions";
import { resolveActiveTab } from "./active-tab";

export const DEFAULT_QUESTION = "No sé qué hacer aquí.";

/** Monotonic local clock (Side Panel always has performance.now). */
function perfNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Local latency instrumentation: duration ONLY. Never the question, the page
 * content, the session or any identifier. No telemetry, no persistence.
 */
function logPerf(metric: string, startedAt: number): void {
  console.log(`[perf] ${metric}=${Math.max(0, Math.round(perfNow() - startedAt))}`);
}

/**
 * Maps a machine-readable error code to a short, non-technical Spanish
 * message for the user. The code itself is logged to the console (codes are
 * not sensitive) for debugging, but never rendered in the UI.
 */
const FRIENDLY_ERRORS: Record<string, string> = {
  network: "No pude conectar con el asistente. Inténtalo de nuevo.",
  backend_timeout: "El asistente no respondió a tiempo. Inténtalo de nuevo.",
  provider_timeout: "Está tardando más de lo normal. Inténtalo de nuevo.",
  provider_unavailable: "El asistente no está disponible ahora mismo. Inténtalo de nuevo.",
  invalid_model_output: "No pude interpretar la respuesta. Inténtalo de nuevo.",
};

const GENERIC_ERROR = "Algo salió mal. Inténtalo de nuevo.";

function friendlyError(error: string): string {
  console.warn(`[navega] assist_error code=${error}`);
  return FRIENDLY_ERRORS[error] ?? GENERIC_ERROR;
}

/**
 * Explicit pending help request. Holds the EXACT original question plus the
 * minimal context needed to retry AFTER a site-permission grant. It NEVER
 * stores a DOM snapshot (a fresh PageContext is always captured after grant),
 * and it is discarded if the user navigates to a different origin before
 * granting.
 */
export interface PendingHelpRequest {
  question: string;
  tabId: number;
  url: string;
  origin: string;
  pattern: string;
}

export class PermissionRequiredError extends Error {
  constructor(readonly pattern: string, readonly origin: string) {
    super("permission_required");
  }
}

export class UnsupportedPageError extends Error {
  constructor(readonly reason: "protected" | "unsupported") {
    super("unsupported_page");
  }
}

/** Minimal chrome surface the controller needs. Injected for testability. */
export interface ChromeFacade {
  getActiveTab(): Promise<{ id?: number; url?: string } | null>;
  capturePageContext(tabId: number): Promise<PageContext>;
  sendAssist(req: {
    context: PageContext;
    question: string;
    session: HelpSession;
  }): Promise<AssistResultMessage>;
  hasPermission(pattern: string): Promise<boolean>;
  requestPermission(pattern: string): Promise<boolean>;
  loadSession(): Promise<HelpSession | null>;
  saveSession(session: HelpSession): Promise<void>;
}

export interface ControllerElements {
  conversation: HTMLElement;
  input: HTMLTextAreaElement;
  helpButton: HTMLButtonElement;
  newHelpButton: HTMLButtonElement;
  status: HTMLElement;
  permission: HTMLElement;
  permissionText: HTMLElement;
  permissionAllow: HTMLButtonElement;
  permissionDeny: HTMLButtonElement;
}

export interface ControllerHandle {
  init(): void;
  askHelp(): Promise<void>;
  reset(): Promise<void>;
  allowOrigin(): Promise<void>;
  denyOrigin(): void;
  onKeydown(event: KeyboardEvent): void;
  currentSession(): HelpSession;
}

export function createController(facade: ChromeFacade, els: ControllerElements): ControllerHandle {
  let session: HelpSession | null = null;
  /** The most recent question that has not yet been answered. */
  let pendingUserText: string | null = null;
  /** Awaiting permission for a specific origin; the retry context. */
  let pendingHelpRequest: PendingHelpRequest | null = null;
  let inFlight = false;

  async function ensureSession(): Promise<HelpSession> {
    if (session) return session;
    session = (await facade.loadSession()) ?? resetSession();
    return session;
  }

  function renderTurn(turn: HelpTurn): void {
    const article = document.createElement("article");
    article.className = `turn turn-${turn.role}`;
    const who = document.createElement("div");
    who.className = "turn-who";
    who.textContent = turn.role === "user" ? "Tú" : "Navega";
    const body = document.createElement("div");
    body.className = "turn-text";
    body.textContent = turn.text;
    article.append(who, body);
    els.conversation.append(article);
  }

  function renderEmptyState(): void {
    const p = document.createElement("p");
    p.className = "conversation-empty";
    p.textContent = "Cuéntame qué te gustaría hacer y te iré guiando paso a paso.";
    els.conversation.append(p);
  }

  function scrollToLatest(): void {
    els.conversation.scrollTop = els.conversation.scrollHeight;
  }

  function renderConversation(): void {
    els.conversation.textContent = "";
    if (!session || session.turns.length === 0) {
      renderEmptyState();
    } else {
      for (const turn of session.turns) renderTurn(turn);
    }
    if (pendingUserText) {
      renderTurn({ role: "user", text: pendingUserText, timestamp: Date.now() });
    }
    scrollToLatest();
  }

  function setStatus(text: string): void {
    els.status.textContent = text;
  }

  function showPermission(origin: string): void {
    els.permissionText.textContent = `Navega necesita permiso para ayudarte en ${displayOrigin(origin)}. Solo pedirá acceso a este sitio, no a todos.`;
    els.permission.hidden = false;
  }

  function hidePermission(): void {
    els.permission.hidden = true;
  }

  function clearPending(): void {
    pendingHelpRequest = null;
  }

  async function captureWithPermission(tabId: number, url: string): Promise<PageContext> {
    const kind = classifyPage(url);
    if (kind !== "supported") {
      throw new UnsupportedPageError(kind);
    }
    try {
      return await facade.capturePageContext(tabId);
    } catch (err) {
      const pattern = originMatchPattern(url);
      const granted = await facade.hasPermission(pattern).catch(() => false);
      if (!granted) {
        throw new PermissionRequiredError(pattern, new URL(url).origin);
      }
      throw err;
    }
  }

  async function runHelp(question: string): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    els.helpButton.disabled = true;
    els.newHelpButton.disabled = true;
    hidePermission();
    clearPending();

    // T_total: user submits → final success/error state rendered (see finally).
    const tTotal = perfNow();
    pendingUserText = question;
    renderConversation();

    let activeTab: { id: number; url: string } | null = null;

    try {
      const s = await ensureSession();
      const tab = await facade.getActiveTab();
      if (!tab?.id) {
        setStatus("No encontré la pestaña activa.");
        return;
      }
      activeTab = { id: tab.id, url: tab.url ?? "" };
      setStatus("Analizando esta página…");
      // T_capture: start of current-page capture → PageContext ready.
      const tCapture = perfNow();
      const context = await captureWithPermission(activeTab.id, activeTab.url);
      logPerf("capture_ms", tCapture);

      const sWithOrigin = setCurrentOrigin(s, pageContextOrigin(context));
      session = sWithOrigin;

      setStatus("Preguntando al asistente…");
      // T_assist_request: extension sends → extension receives backend response.
      const tAssist = perfNow();
      const result = await facade.sendAssist({
        context,
        question,
        session: sWithOrigin,
      });
      logPerf("assist_request_ms", tAssist);

      renderResult(result, question);
    } catch (err) {
      handleError(err, question, activeTab);
    } finally {
      logPerf("total_ms", tTotal);
      inFlight = false;
      els.helpButton.disabled = false;
      els.newHelpButton.disabled = false;
    }
  }

  function renderResult(result: AssistResultMessage, userText: string): void {
    if (result.type !== "GWA_ASSIST_RESULT") {
      setStatus(GENERIC_ERROR);
      return;
    }
    if (!result.ok) {
      setStatus(friendlyError(result.error));
      return;
    }
    if (session) {
      session = appendTurn(session, "user", userText);
      session = appendTurn(session, "assistant", result.decision.message);
      pendingUserText = null;
      void facade.saveSession(session);
    }
    setStatus("");
    renderConversation();
  }

  function handleError(
    err: unknown,
    question: string,
    activeTab: { id: number; url: string } | null,
  ): void {
    if (err instanceof PermissionRequiredError) {
      setStatus(`No puedo ver el contenido de esta página. ${displayOrigin(err.origin)} puede permitir el acceso.`);
      showPermission(err.origin);
      if (activeTab) {
        // Preserve the EXACT original user question so that a later grant
        // re-runs the same intent instead of DEFAULT_QUESTION.
        pendingHelpRequest = {
          question,
          tabId: activeTab.id,
          url: activeTab.url,
          origin: err.origin,
          pattern: err.pattern,
        };
      }
      return;
    }
    if (err instanceof UnsupportedPageError) {
      setStatus(
        err.reason === "protected"
          ? "Navega no puede ayudar en las páginas internas del navegador (como la tienda o la configuración)."
          : "Navega solo puede ayudar en páginas web normales, no en este tipo de página.",
      );
      return;
    }
    // Never render raw Error text (it can contain URLs/technical detail).
    // Only the error CLASS goes to the local console, never to the UI.
    console.warn(`[navega] unexpected_error name=${err instanceof Error ? err.name : typeof err}`);
    setStatus(GENERIC_ERROR);
  }

  async function allowOrigin(): Promise<void> {
    const pending = pendingHelpRequest;
    if (!pending) return;
    const ok = await facade.requestPermission(pending.pattern).catch(() => false);
    if (!ok) {
      // The user did not grant: expire the pending retry and show a clear
      // status. Do NOT leave a reusable stale request behind.
      hidePermission();
      clearPending();
      setStatus("Necesitas permitir el acceso para que Navega pueda ver esta página.");
      return;
    }
    // Re-resolve the active page after the grant. If the user navigated before
    // granting, do NOT apply the old question to the wrong origin.
    const tab = await facade.getActiveTab();
    if (!tab?.id) {
      clearPending();
      setStatus("No encontré la pestaña activa.");
      return;
    }
    const url = tab.url ?? "";
    const origin = originOf(url);
    if (tab.id !== pending.tabId || origin !== pending.origin) {
      clearPending();
      setStatus("Se abrió otra página mientras se pedía permiso. Pregunta de nuevo cuando estés en esa página.");
      return;
    }
    hidePermission();
    clearPending();
    setStatus("Permiso concedido. Inténtalo de nuevo.");
    await runHelp(pending.question);
  }

  function denyOrigin(): void {
    hidePermission();
    clearPending();
    setStatus("No hay permiso para ver esta página. Puedes pedir ayuda en otra página.");
  }

  async function reset(): Promise<void> {
    hidePermission();
    pendingUserText = null;
    clearPending();
    session = resetSession();
    els.input.value = "";
    setStatus("");
    await facade.saveSession(session);
    renderConversation();
  }

  function onKeydown(event: KeyboardEvent): void {
    // Enter submits; Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void askHelp();
    }
  }

  async function askHelp(): Promise<void> {
    if (inFlight) return;
    const text = els.input.value.trim() || DEFAULT_QUESTION;
    els.input.value = "";
    await runHelp(text);
  }

  function init(): void {
    void (async () => {
      await ensureSession();
      renderConversation();
    })();
  }

  return {
    init,
    askHelp,
    reset,
    allowOrigin,
    denyOrigin,
    onKeydown,
    currentSession: () => session as HelpSession,
  };
}

/** The origin of the top-level (main) frame, or "" if unknown. */
export function pageContextOrigin(context: PageContext): string {
  const top = context.frames.find((f) => f.frameId === context.topFrameId);
  const candidate = top ?? context.frames[0];
  return candidate?.origin ?? candidate?.snapshot?.page.origin ?? "";
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** Build a chrome-backed facade used by the real side panel entry. */
export function createChromeFacade(cc: typeof chrome): ChromeFacade {
  return {
    getActiveTab: async () =>
      resolveActiveTab(
        async () => {
          const [tab] = await cc.tabs.query({ active: true, currentWindow: true });
          return tab ? { id: tab.id, url: tab.url } : null;
        },
        async (tabId) => {
          const frame = await cc.webNavigation.getFrame({ tabId, frameId: 0 });
          return frame?.url;
        },
      ),
    capturePageContext: (tabId: number) =>
      capturePageContext({
        tabId,
        enumerateFrames: async () => {
          const frames = await cc.webNavigation.getAllFrames({ tabId });
          return (frames ?? []).map((f) => ({
            frameId: f.frameId,
            parentFrameId: f.parentFrameId ?? -1,
            url: f.url ?? "",
          }));
        },
        setCaptureToken: async (frameId, token) => {
          await cc.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            func: (t: string) => {
              (globalThis as { __GWA_CAPTURE_TOKEN__?: string }).__GWA_CAPTURE_TOKEN__ = t;
            },
            args: [token],
          });
        },
        injectExtractor: async (frameId) => {
          await cc.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            files: ["content/extract.js"],
          });
        },
        onMessage: (listener) => {
          const handler = (message: unknown, sender: chrome.runtime.MessageSender) => {
            const msg = message as
              | { type?: string; snapshot?: AccessibleDOMSnapshot; captureToken?: string }
              | undefined;
            listener({
              type: msg?.type,
              snapshot: msg?.snapshot,
              captureToken: msg?.captureToken,
              senderTabId: sender?.tab?.id,
              senderFrameId: sender?.frameId,
              senderOrigin: sender?.origin,
              senderUrl: sender?.url,
            });
          };
          cc.runtime.onMessage.addListener(handler);
          return () => cc.runtime.onMessage.removeListener(handler);
        },
      }),
    sendAssist: (req) =>
      cc.runtime.sendMessage({ type: "GWA_ASSIST", ...req }) as Promise<AssistResultMessage>,
    hasPermission: (pattern: string) =>
      cc.permissions.contains({ origins: [pattern] }) as unknown as Promise<boolean>,
    requestPermission: (pattern: string) =>
      cc.permissions.request({ origins: [pattern] }) as unknown as Promise<boolean>,
    loadSession: async () => {
      const stored = await cc.storage.session.get("helpSession");
      const value = stored.helpSession as HelpSession | undefined;
      return value ?? null;
    },
    saveSession: async (s: HelpSession) => {
      await cc.storage.session.set({ helpSession: s });
    },
  };
}
