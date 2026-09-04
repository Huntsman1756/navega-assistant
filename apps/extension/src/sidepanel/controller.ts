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
import { buildPageContext, type FrameInput } from "@guided-web/accessible-dom";
import {
  appendTurn,
  resetSession,
  setCurrentOrigin,
} from "../session/session";
import { classifyPage, originMatchPattern, displayOrigin } from "../permissions/permissions";

export const DEFAULT_QUESTION = "No sé qué hacer aquí.";
const SNAPSHOT_TIMEOUT_MS = 6000;

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
  /** Awaiting permission for a specific origin. */
  let pendingPermission = { pattern: "", origin: "" };
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
    pendingPermission = { pattern: originMatchPattern(origin), origin };
    els.permissionText.textContent = `Navega necesita permiso para ayudarte en ${displayOrigin(origin)}. Solo pedirá acceso a este sitio, no a todos.`;
    els.permission.hidden = false;
  }

  function hidePermission(): void {
    pendingPermission = { pattern: "", origin: "" };
    els.permission.hidden = true;
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

  async function askHelp(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    els.helpButton.disabled = true;
    els.newHelpButton.disabled = true;
    hidePermission();

    const text = els.input.value.trim() || DEFAULT_QUESTION;
    els.input.value = "";
    pendingUserText = text;
    renderConversation();

    try {
      const s = await ensureSession();
      const tab = await facade.getActiveTab();
      if (!tab?.id) {
        setStatus("No encontré la pestaña activa.");
        return;
      }
      const url = tab.url ?? "";
      setStatus("Analizando esta página…");
      const context = await captureWithPermission(tab.id, url);

      const sWithOrigin = setCurrentOrigin(s, pageContextOrigin(context));
      session = sWithOrigin;

      setStatus("Preguntando al asistente…");
      // The current question is NOT in history yet; it is the "current intent".
      const result = await facade.sendAssist({
        context,
        question: text,
        session: sWithOrigin,
      });

      renderResult(result, text);
    } catch (err) {
      handleError(err);
    } finally {
      inFlight = false;
      els.helpButton.disabled = false;
      els.newHelpButton.disabled = false;
    }
  }

  function renderResult(result: AssistResultMessage, userText: string): void {
    if (result.type !== "GWA_ASSIST_RESULT") {
      setStatus("No pude ayudarte con eso.");
      return;
    }
    if (!result.ok) {
      setStatus(`No pude ayudarte con eso. (${result.error})`);
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

  function handleError(err: unknown): void {
    if (err instanceof PermissionRequiredError) {
      setStatus(`No puedo ver el contenido de esta página. ${displayOrigin(err.origin)} puede permitir el acceso.`);
      showPermission(err.origin);
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
    setStatus(`Algo salió mal. Inténtalo de nuevo. (${err instanceof Error ? err.message : String(err)})`);
  }

  async function allowOrigin(): Promise<void> {
    if (!pendingPermission.pattern) return;
    const ok = await facade.requestPermission(pendingPermission.pattern).catch(() => false);
    if (ok) {
      hidePermission();
      setStatus("Permiso concedido. Inténtalo de nuevo.");
      await askHelp();
    } else {
      setStatus("Necesitas permitir el acceso para que Navega pueda ver esta página.");
    }
  }

  function denyOrigin(): void {
    hidePermission();
    setStatus("No hay permiso para ver esta página. Puedes pedir ayuda en otra página.");
  }

  async function reset(): Promise<void> {
    hidePermission();
    pendingUserText = null;
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
  const SNAPSHOT_MESSAGE = "GWA_SNAPSHOT";

  return {
    getActiveTab: async () => {
      const [tab] = await cc.tabs.query({ active: true, currentWindow: true });
      return tab ? { id: tab.id, url: tab.url } : null;
    },
    capturePageContext: (tabId: number) =>
      new Promise<PageContext>((resolve, reject) => {
        let settled = false;
        const collected = new Map<number, { frameId: number; origin: string; snapshot: AccessibleDOMSnapshot }>();
        let knownFrames: Array<{ frameId: number; parentFrameId: number; url: string }> = [];

        const close = () => {
          clearTimeout(timeout);
          cc.runtime.onMessage.removeListener(onMessage);
        };

        const finish = () => {
          if (settled) return;
          settled = true;
          close();
          const inputs: FrameInput[] = [];
          if (knownFrames.length > 0) {
            for (const f of knownFrames) {
              const got = collected.get(f.frameId);
              if (got) {
                inputs.push({
                  frameId: f.frameId,
                  parentFrameId: f.parentFrameId,
                  origin: got.origin,
                  accessible: true,
                  snapshot: got.snapshot,
                });
              } else {
                // A frame we know about but could not read (e.g. cross-origin):
                // represent it explicitly as unavailable, never as empty.
                inputs.push({
                  frameId: f.frameId,
                  parentFrameId: f.parentFrameId,
                  origin: originOf(f.url),
                  accessible: false,
                  unavailableReason: "cross_origin_unavailable",
                });
              }
            }
          } else {
            for (const [frameId, got] of collected) {
              inputs.push({ frameId, origin: got.origin, accessible: true, snapshot: got.snapshot });
            }
          }
          if (inputs.length === 0) {
            reject(new Error("no frame data captured"));
            return;
          }
          const topFrameId = knownFrames.find((f) => f.parentFrameId === -1)?.frameId ?? 0;
          // If the top-level frame itself cannot be read we cannot help at all:
          // surface the permission/access error rather than pretending the page
          // is empty. Inaccessible CHILD frames are tolerated and represented
          // explicitly as unavailable.
          const top = inputs.find((i) => i.frameId === topFrameId) ?? inputs[0];
          if (!top?.accessible) {
            reject(new Error("top frame unavailable"));
            return;
          }
          resolve(buildPageContext(topFrameId, inputs));
        };

        const timeout = setTimeout(finish, SNAPSHOT_TIMEOUT_MS);

        const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
          const msg = message as { type?: string; snapshot?: AccessibleDOMSnapshot } | undefined;
          if (msg?.type === SNAPSHOT_MESSAGE && msg.snapshot) {
            const frameId = sender?.frameId ?? 0;
            collected.set(frameId, {
              frameId,
              origin: sender?.origin ?? originOf(sender?.url ?? ""),
              snapshot: msg.snapshot,
            });
          }
        };
        cc.runtime.onMessage.addListener(onMessage);

        void (async () => {
          // Enumerate the frame tree (best effort; not all contexts report).
          if (cc.webNavigation?.getAllFrames) {
            try {
              knownFrames = (await cc.webNavigation.getAllFrames({ tabId })) ?? [];
            } catch {
              knownFrames = [];
            }
          }
          try {
            // Inject the extractor into every context the extension can reach.
            await cc.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content/extract.js"] });
          } catch {
            // Some frames may be unreachable; we still assemble below.
          }
          // Give frame messages a moment to arrive before assembling.
          setTimeout(finish, 250);
        })();
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
