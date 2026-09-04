// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { createController, DEFAULT_QUESTION, type ControllerElements, type ChromeFacade } from "./controller";
import type { AccessibleDOMSnapshot, HelpSession, PageContext } from "@guided-web/protocol";
import type { AssistResultMessage } from "../shared/messages";

function snapshotFor(url: string, name: string): AccessibleDOMSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "s-1",
    page: { url, origin: new URL(url).origin, title: name },
    elements: [{ id: "el-0", tag: "button", role: "button", accessibleName: name, interactive: true }],
    visibleText: [],
  };
}

function contextFor(url: string, name: string): PageContext {
  const snap = snapshotFor(url, name);
  return {
    schemaVersion: 1,
    topFrameId: 0,
    frames: [{ frameId: 0, parentFrameId: -1, origin: snap.page.origin, accessible: true, snapshot: snap }],
  };
}

function okResult(message: string): AssistResultMessage {
  return { type: "GWA_ASSIST_RESULT", ok: true, decision: { kind: "explain", message } };
}

function errResult(error: string): AssistResultMessage {
  return { type: "GWA_ASSIST_RESULT", ok: false, error };
}

interface FacadeOptions {
  tab?: { id?: number; url?: string } | null;
  context?: PageContext;
  captureError?: unknown;
  hasPermission?: boolean;
  requestPermission?: boolean;
  loadSession?: HelpSession | null;
  result?: (question: string, session: HelpSession) => AssistResultMessage;
  snapshotError?: unknown;
}

function makeFacade(opts: FacadeOptions = {}) {
  const calls = { capture: 0, assist: 0, save: 0, reset: 0, load: 0 };
  const saved: HelpSession[] = [];
  const assistRequests: Array<{ question: string; session: HelpSession }> = [];
  let permission = opts.hasPermission ?? false;

  const facade: ChromeFacade = {
    getActiveTab: async () => (opts.tab === undefined ? { id: 1, url: "https://example.com/login" } : opts.tab),
    capturePageContext: async () => {
      calls.capture += 1;
      if (opts.captureError !== undefined) throw opts.captureError;
      return opts.context ?? contextFor("https://example.com/login", "Sign in");
    },
    sendAssist: async (req) => {
      calls.assist += 1;
      assistRequests.push({ question: req.question, session: req.session });
      return (opts.result ?? ((q: string) => okResult(`ayuda-${q}`)))(req.question, req.session);
    },
    hasPermission: async () => permission,
    requestPermission: async () => {
      permission = opts.requestPermission ?? true;
      return permission;
    },
    loadSession: async () => {
      calls.load += 1;
      return opts.loadSession ?? null;
    },
    saveSession: async (s) => {
      calls.save += 1;
      saved.push(s);
    },
  };
  return { facade, calls, saved, assistRequests, setPermission: (v: boolean) => (permission = v) };
}

function buildElements(): ControllerElements {
  const conversation = document.createElement("div");
  const input = document.createElement("textarea");
  const helpButton = document.createElement("button");
  const newHelpButton = document.createElement("button");
  const status = document.createElement("div");
  const permission = document.createElement("section");
  const permissionText = document.createElement("p");
  const permissionAllow = document.createElement("button");
  const permissionDeny = document.createElement("button");
  return {
    conversation,
    input,
    helpButton,
    newHelpButton,
    status,
    permission,
    permissionText,
    permissionAllow,
    permissionDeny,
  };
}

function conversationText(els: ControllerElements): string {
  return els.conversation.textContent ?? "";
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("conversation rendering", () => {
  it("loads and displays the existing help conversation with both turns", async () => {
    const { facade } = makeFacade({
      loadSession: {
        schemaVersion: 1,
        sessionId: "s-x",
        goal: "Quiero un correo de GitHub.",
        turns: [
          { role: "user", text: "Quiero un correo de GitHub.", timestamp: 1 },
          { role: "assistant", text: "Estás en Gmail. Pulsa “Recibidos”.", timestamp: 2 },
        ],
      },
    });
    const els = buildElements();
    const c = createController(facade, els);
    c.init();
    await new Promise((r) => setTimeout(r, 20));
    const text = conversationText(els);
    expect(text).toContain("Tú");
    expect(text).toContain("Navega");
    expect(text).toContain("Quiero un correo de GitHub.");
    expect(text).toContain("Estás en Gmail. Pulsa “Recibidos”.");
  });

  it("keeps previous turns visible after a successful new turn", async () => {
    const { facade } = makeFacade();
    const els = buildElements();
    const c = createController(facade, els);
    await c.askHelp();
    await c.askHelp();
    const text = conversationText(els);
    expect(text).toContain("Tú");
    expect(text).toContain("Navega");
    expect(text).toContain("ayuda-");
  });
});

describe("input keydown behaviour", () => {
  it("Enter submits the question", async () => {
    const { facade, calls } = makeFacade();
    const els = buildElements();
    const c = createController(facade, els);
    els.input.value = "¿Qué hago ahora?";
    const ev = new KeyboardEvent("keydown", { key: "Enter", shiftKey: false, bubbles: true, cancelable: true });
    c.onKeydown(ev);
    expect(ev.defaultPrevented).toBe(true);
    await expect.poll(() => calls.assist).toBe(1);
  });

  it("Shift+Enter inserts a newline and does not submit", async () => {
    const { facade, calls } = makeFacade();
    const els = buildElements();
    const c = createController(facade, els);
    els.input.value = "hola";
    const ev = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    c.onKeydown(ev);
    expect(ev.defaultPrevented).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.assist).toBe(0);
  });
});

describe("request lifecycle", () => {
  it("does not double-submit while a request is in flight", async () => {
    let resolveAssist: (v: AssistResultMessage) => void = () => {};
    const gate = new Promise<AssistResultMessage>((res) => (resolveAssist = res));
    const { facade, calls } = makeFacade({ result: () => okResult("ok") });
    facade.sendAssist = () => {
      calls.assist += 1;
      return gate;
    };
    const els = buildElements();
    const c = createController(facade, els);
    const p1 = c.askHelp();
    const p2 = c.askHelp();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.assist).toBe(1);
    resolveAssist(okResult("ok"));
    await Promise.all([p1, p2]);
    expect(calls.assist).toBe(1);
  });

  it("preserves previous turns and shows an error without inventing an answer", async () => {
    let failNext = false;
    const { facade } = makeFacade({
      result: () => (failNext ? errResult("red") : okResult("primera ayuda")),
    });
    const els = buildElements();
    const c = createController(facade, els);
    await c.askHelp();
    failNext = true;
    await c.askHelp();
    const text = conversationText(els);
    expect(text).toContain("primera ayuda");
    // No invented assistant response for the failed turn; error is shown.
    expect(text).not.toContain("ayuda-tweet");
    expect(els.status.textContent).toContain("red");
    // The finished history still has exactly the two answered turns.
    expect(c.currentSession().turns).toHaveLength(2);
  });
});

describe("reset / new help", () => {
  it("clears only the current help session", async () => {
    const { facade, calls, saved } = makeFacade();
    const els = buildElements();
    const c = createController(facade, els);
    await c.askHelp();
    expect(c.currentSession().turns.length).toBeGreaterThan(0);
    await c.reset();
    const fresh = c.currentSession();
    expect(fresh.turns).toHaveLength(0);
    expect(conversationText(els)).toContain("Cuéntame");
    // The fresh session was checkpointed.
    expect(saved[saved.length - 1]!.sessionId).toBe(fresh.sessionId);
    expect(calls.save).toBeGreaterThan(0);
  });
});

describe("permission UX", () => {
  it("shows a permission prompt instead of an opaque technical error", async () => {
    const { facade } = makeFacade({
      tab: { id: 1, url: "https://mail.google.com/mail" },
      context: contextFor("https://mail.google.com/mail", "Recibidos"),
      captureError: new Error("Cannot access contents of the page. Extension manifest must request permission to access the respective host."),
      hasPermission: false,
    });
    const els = buildElements();
    const c = createController(facade, els);
    await c.askHelp();
    expect(els.permission.hidden).toBe(false);
    expect(els.permissionText.textContent).toContain("mail.google.com");
    expect(els.status.textContent).toContain("No puedo ver el contenido");
  });

  it("grants permission and retries safely", async () => {
    let throwFirst = true;
    const { facade, calls } = makeFacade({
      tab: { id: 1, url: "https://mail.google.com/mail" },
      context: contextFor("https://mail.google.com/mail", "Recibidos"),
      hasPermission: false,
      requestPermission: true,
    });
    facade.capturePageContext = async () => {
      calls.capture += 1;
      if (throwFirst) {
        throwFirst = false;
        throw new Error("host permission denied");
      }
      return contextFor("https://mail.google.com/mail", "Recibidos");
    };
    const els = buildElements();
    const c = createController(facade, els);
    await c.askHelp();
    expect(els.permission.hidden).toBe(false);
    await c.allowOrigin();
    expect(calls.assist).toBe(1);
    expect(els.permission.hidden).toBe(true);
  });

  it("denying permission degrades cleanly", async () => {
    const { facade } = makeFacade({
      tab: { id: 1, url: "https://mail.google.com/mail" },
      context: contextFor("https://mail.google.com/mail", "Recibidos"),
      captureError: new Error("host permission denied"),
      hasPermission: false,
    });
    const els = buildElements();
    const c = createController(facade, els);
    await c.askHelp();
    expect(els.permission.hidden).toBe(false);
    c.denyOrigin();
    expect(els.permission.hidden).toBe(true);
    expect(els.status.textContent).toContain("permiso");
  });

  it("protected browser pages degrade cleanly", async () => {
    const { facade, calls } = makeFacade({ tab: { id: 1, url: "chrome://extensions" } });
    const els = buildElements();
    const c = createController(facade, els);
    await c.askHelp();
    expect(calls.assist).toBe(0);
    expect(els.status.textContent).toContain("Navega no puede ayudar");
    expect(els.permission.hidden).toBe(true);
  });

  it("preserves the EXACT original question across a permission grant (Fix B)", async () => {
    let throwCapture = true;
    const { facade, calls, assistRequests } = makeFacade({
      tab: { id: 1, url: "https://mail.google.com/mail" },
      hasPermission: false,
      requestPermission: true,
    });
    facade.capturePageContext = async () => {
      calls.capture += 1;
      if (throwCapture) {
        throwCapture = false;
        throw new Error("host permission denied");
      }
      return contextFor("https://mail.google.com/mail", "Recibidos");
    };
    const els = buildElements();
    const c = createController(facade, els);
    els.input.value = "¿Dónde puedo cambiar mi contraseña?";
    await c.askHelp();
    expect(els.permission.hidden).toBe(false);
    // No backend request is made before the grant.
    expect(calls.assist).toBe(0);

    await c.allowOrigin();
    expect(calls.assist).toBe(1);
    // The EXACT original question reached the backend — NOT the default.
    expect(assistRequests[0]?.question).toBe("¿Dónde puedo cambiar mi contraseña?");
    expect(assistRequests[0]?.question).not.toBe(DEFAULT_QUESTION);
    // A FRESH PageContext was captured after the grant (not a stale one).
    expect(calls.capture).toBe(2);
    // The original question appears exactly once, as a single user turn.
    const userTurns = c.currentSession().turns.filter((t) => t.role === "user");
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0]?.text).toBe("¿Dónde puedo cambiar mi contraseña?");
    expect(conversationText(els)).toContain("¿Dónde puedo cambiar mi contraseña?");
    expect(els.permission.hidden).toBe(true);
  });

  it("denying permission sends no model request and keeps the conversation intact (Fix B)", async () => {
    const { facade, calls } = makeFacade({
      tab: { id: 1, url: "https://mail.google.com/mail" },
      captureError: new Error("host permission denied"),
      hasPermission: false,
      requestPermission: false,
    });
    const els = buildElements();
    const c = createController(facade, els);
    els.input.value = "¿Dónde puedo cambiar mi contraseña?";
    await c.askHelp();
    expect(els.permission.hidden).toBe(false);
    await c.allowOrigin();
    expect(calls.assist).toBe(0);
    expect(c.currentSession().turns).toHaveLength(0);
    expect(els.permission.hidden).toBe(true);
  });

  it("does NOT apply the old question to a different origin if the user navigated before granting (Fix B)", async () => {
    let currentUrl = "https://mail.google.com/mail";
    let throwCapture = true;
    const { facade, calls } = makeFacade({
      tab: { id: 1, url: currentUrl },
      hasPermission: false,
      requestPermission: true,
    });
    facade.getActiveTab = async () => ({ id: 1, url: currentUrl });
    facade.capturePageContext = async () => {
      if (throwCapture) {
        throwCapture = false;
        throw new Error("host permission denied");
      }
      return contextFor(currentUrl, "Page");
    };
    const els = buildElements();
    const c = createController(facade, els);
    els.input.value = "¿Dónde puedo cambiar mi contraseña?";
    await c.askHelp();
    expect(els.permission.hidden).toBe(false);

    // User navigates to a different origin before granting.
    currentUrl = "https://el-mundo.es/noticias";
    await c.allowOrigin();
    expect(calls.assist).toBe(0);
    expect(els.status.textContent).toContain("Se abrió otra página");
    // The intent is not stashed against the wrong origin.
    expect(c.currentSession().turns).toHaveLength(0);
  });
});
