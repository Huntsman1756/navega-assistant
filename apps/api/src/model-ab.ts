import { loadConfig } from "./config";
import { OpenAICompatibleProvider, ProviderHttpError } from "@guided-web/provider";
import { P0AssistantDecisionSchema, type PageContext, type HelpSession, type AccessibleElement } from "@guided-web/protocol";
import { buildSystemPrompt } from "./prompt";

type AbResult = {
  model: string;
  caseId: string;
  httpOutcome: "200" | "timeout" | "error";
  latencyMs: number;
  schemaValid: boolean;
  guidanceCorrect: boolean;
  guidanceUnclear: boolean;
  targetCorrect: boolean;
  kind?: string;
};

type CaseDef = {
  id: string;
  category: string;
  question: string;
  session?: HelpSession;
  context: PageContext;
  targets: string[];
  kinds: string[];
};

function el(id: string, role: string, name: string, tag?: string): AccessibleElement {
  const t = tag ?? (role === "textbox" ? "input" : role === "heading" ? "h2" : role === "link" ? "a" : "button");
  return {
    id,
    tag: t,
    role,
    accessibleName: name,
    interactive: role !== "heading",
    ...(id === "f1" ? { state: { focused: true } } : {}),
  };
}

function ctx(title: string, elements: AccessibleElement[], visibleText: string[], url = "https://fixture.invalid/page"): PageContext {
  const snapshot = {
    schemaVersion: 1 as const,
    snapshotId: `ab-${title}`,
    page: { url, origin: "https://fixture.invalid", title },
    elements,
    visibleText,
  };
  return {
    schemaVersion: 1,
    topFrameId: 0,
    frames: [{ frameId: 0, parentFrameId: -1, origin: "https://fixture.invalid", accessible: true, snapshot }],
  };
}

function largeContext(title: string, n: number): PageContext {
  const roles = ["button", "textbox", "link", "heading"];
  const elements = Array.from({ length: n }, (_, i) => {
    const role = roles[i % roles.length] ?? "button";
    return el(`el-${i}`, role, role === "heading" ? `Section ${i}` : `${role} ${i}`, role === "heading" ? "h2" : undefined);
  });
  return ctx(title, elements, Array.from({ length: 20 }, (_, i) => `Paragraph ${i}`));
}

const session = (turns: Array<{ role: "user" | "assistant"; text: string }>): HelpSession => ({
  schemaVersion: 1,
  sessionId: "ab-session",
  turns: turns.map((t, i) => ({ ...t, timestamp: 1000 + i })),
});

const cases: CaseDef[] = [
  // 1. Simple login
  {
    id: "login-basic",
    category: "login",
    question: "No sé cómo iniciar sesión.",
    context: ctx("Iniciar sesión", [
      el("u", "textbox", "Usuario"),
      el("p", "textbox", "Contraseña"),
      el("b", "button", "Iniciar sesión"),
    ], ["Usuario", "Contraseña", "Iniciar sesión"]),
    targets: ["Iniciar sesión", "Entrar", "Acceder", "Entrar"],
    kinds: ["explain"],
  },
  // 2. Password recovery
  {
    id: "recovery-link",
    category: "login",
    question: "¿Cómo recupero mi contraseña?",
    context: ctx("Iniciar sesión", [
      el("u", "textbox", "Usuario"),
      el("l", "link", "¿Olvidaste tu contraseña?"),
      el("b", "button", "Iniciar sesión"),
    ], ["Usuario", "¿Olvidaste tu contraseña?"]),
    targets: ["Olvidaste tu contraseña", "Olvidaste", "recuperar"],
    kinds: ["explain"],
  },
  // 3. Form: fill fields
  {
    id: "form-first-field",
    category: "form",
    question: "¿Qué escribo aquí?",
    context: ctx("Complete el formulario", [
      el("n", "textbox", "Nombre"),
      el("c", "textbox", "Correo electrónico"),
      el("s", "button", "Enviar"),
    ], ["Nombre", "Correo electrónico", "Enviar"]),
    targets: ["Nombre"],
    kinds: ["explain"],
  },
  // 4. Form: next action
  {
    id: "form-next",
    category: "form",
    question: "¿Qué hago primero en este formulario?",
    context: ctx("Registro", [
      el("n", "textbox", "Nombre"),
      el("e", "textbox", "Apellidos"),
      el("b", "button", "Continuar"),
    ], ["Nombre", "Apellidos", "Continuar"]),
    targets: ["Nombre"],
    kinds: ["explain"],
  },
  // 5. Confusing / error state
  {
    id: "error-retry",
    category: "error",
    question: "Me salió un error, ¿qué hago?",
    context: ctx("No se pudo iniciar sesión", [
      el("r", "button", "Reintentar"),
      el("h", "button", "Volver al inicio"),
    ], ["No se pudo iniciar sesión", "Reintentar"]),
    targets: ["Reintentar"],
    kinds: ["explain"],
  },
  // 6. Confusing / ambiguous page
  {
    id: "confusing-ambiguous",
    category: "error",
    question: "¿Qué debo hacer ahora?",
    context: ctx("Página", [
      el("x", "button", "Aceptar"),
      el("y", "button", "Cancelar"),
      el("z", "link", "Más información"),
    ], ["Aceptar", "Cancelar"]),
    targets: ["Aceptar", "Cancelar"],
    kinds: ["explain", "ask_user"],
  },
  // 7. Article / explanation
  {
    id: "article-explain",
    category: "article",
    question: "¿Qué significa este texto?",
    context: ctx("Ayuda", [
      el("h1", "heading", "Cómo cambiar tu contraseña"),
      el("h2", "heading", "Paso 1"),
    ], ["Cómo cambiar tu contraseña", "Paso 1"]),
    targets: ["Paso 1", "cambiar"],
    kinds: ["explain"],
  },
  // 8. Article / read action
  {
    id: "article-read",
    category: "article",
    question: "¿Qué tengo que hacer?",
    context: ctx("Instrucciones", [
      el("h1", "heading", "Pasos para darte de alta"),
      el("h2", "heading", "Paso 1: rellena tus datos"),
    ], ["Pasos para darte de alta", "Paso 1"]),
    targets: ["Paso 1", "datos"],
    kinds: ["explain"],
  },
  // 9. Follow-up state change
  {
    id: "follow-up",
    category: "followup",
    question: "ya estoy",
    session: session([{ role: "user", text: "¿Cómo entro?" }, { role: "assistant", text: "Ahora: Escribe tu nombre en Usuario." }]),
    context: ctx("Cuenta", [
      el("c1", "textbox", "Código de verificación"),
      el("c2", "button", "Confirmar"),
    ], ["Código de verificación", "Confirmar"]),
    targets: ["Confirmar", "Código de verificación"],
    kinds: ["explain"],
  },
  // 10. Permission-like fixture
  {
    id: "permission",
    category: "permission",
    question: "¿Debo dar permiso?",
    context: ctx("Permiso", [
      el("a", "button", "Permitir el acceso"),
      el("d", "button", "No permitir"),
    ], ["Permitir el acceso", "No permitir"]),
    targets: ["Permitir"],
    kinds: ["explain"],
  },
  // 11-16. Larger bounded DOM
  {
    id: "large-dom-1",
    category: "large",
    question: "¿Qué debo hacer en esta página?",
    context: largeContext("Página principal", 130),
    targets: ["button 0", "button", "Section"],
    kinds: ["explain"],
  },
  {
    id: "large-dom-2",
    category: "large",
    question: "¿Cuál es el primer paso?",
    context: largeContext("Tramite", 130),
    targets: ["Section", "button", "textbox"],
    kinds: ["explain", "ask_user"],
  },
  {
    id: "large-dom-3",
    category: "large",
    question: "No sé por dónde empezar.",
    context: largeContext("Formulario largo", 130),
    targets: ["Section", "textbox", "button"],
    kinds: ["explain", "ask_user"],
  },
  // 17. Login with secret warning
  {
    id: "login-secret",
    category: "login",
    question: "¿Qué hago con la contraseña?",
    context: ctx("Iniciar sesión", [
      el("u", "textbox", "Usuario"),
      el("p", "textbox", "Contraseña"),
      el("b", "button", "Entrar"),
    ], ["Usuario", "Contraseña", "Entrar"]),
    targets: ["Entrar"],
    kinds: ["explain"],
  },
  // 18. Form: continue button
  {
    id: "form-continue",
    category: "form",
    question: "¿Y ahora qué?",
    context: ctx("Datos", [
      el("n", "textbox", "Nombre"),
      el("b", "button", "Continuar"),
    ], ["Nombre", "Continuar"]),
    targets: ["Continuar"],
    kinds: ["explain"],
  },
  // 19. Confusing / insufficient
  {
    id: "insufficient",
    category: "error",
    question: "¿Qué hago? No veo nada.",
    context: ctx("Página vacía", [], ["Esta página está vacía"]),
    targets: [],
    kinds: ["cannot_help", "ask_user"],
  },
  // 20. Article: find link
  {
    id: "article-find",
    category: "article",
    question: "¿Dónde está el botón para continuar?",
    context: ctx("Ayuda", [
      el("h1", "heading", "Cómo continuar"),
      el("c", "link", "Continuar al siguiente paso"),
    ], ["Cómo continuar", "Continuar al siguiente paso"]),
    targets: ["Continuar al siguiente paso", "Continuar"],
    kinds: ["explain"],
  },
  // 21. Permission: deny path
  {
    id: "permission-no",
    category: "permission",
    question: "¿Puedo dejar de dar permiso?",
    context: ctx("Permiso", [
      el("a", "button", "Permitir"),
      el("d", "button", "No permitir"),
    ], ["Permitir", "No permitir"]),
    targets: ["No permitir"],
    kinds: ["explain"],
  },
  // 22. Follow-up: next step on current page
  {
    id: "followup-next",
    category: "followup",
    question: "¿y qué hago ahora?",
    session: session([{ role: "user", text: "¿Cómo me registro?" }, { role: "assistant", text: "Ahora: Escribe tu nombre." }]),
    context: ctx("Registro", [
      el("n", "textbox", "Correo electrónico"),
      el("b", "button", "Siguiente"),
    ], ["Correo electrónico", "Siguiente"]),
    targets: ["Siguiente", "Correo electrónico"],
    kinds: ["explain"],
  },
  // 23. Large DOM: 130 elements
  {
    id: "large-dom-4",
    category: "large",
    question: "¿En qué parte debo hacer clic?",
    context: largeContext("Panel de control", 130),
    targets: ["button", "Section"],
    kinds: ["explain", "ask_user"],
  },
  // 24. Form: submit
  {
    id: "form-submit",
    category: "form",
    question: "¿Cómo termino de completar esto?",
    context: ctx("Pago", [
      el("n", "textbox", "Número de tarjeta"),
      el("b", "button", "Pagar"),
    ], ["Número de tarjeta", "Pagar"]),
    targets: ["Pagar"],
    kinds: ["explain"],
  },
  // 25. Form: email field
  {
    id: "form-email",
    category: "form",
    question: "¿Qué correo escribo aquí?",
    context: ctx("Contacto", [
      el("e", "textbox", "Correo electrónico"),
      el("b", "button", "Continuar"),
    ], ["Correo electrónico", "Continuar"]),
    targets: ["Correo electrónico", "Correo"],
    kinds: ["explain"],
  },
  // 26. Error: page not found
  {
    id: "error-404",
    category: "error",
    question: "¿Qué hago si no encuentro la página?",
    context: ctx("Página no encontrada", [
      el("h", "link", "Volver al inicio"),
    ], ["Página no encontrada", "Volver al inicio"]),
    targets: ["Volver al inicio", "Volver"],
    kinds: ["explain"],
  },
  // 27. Follow-up: confirm
  {
    id: "followup-confirm",
    category: "followup",
    question: "listo",
    session: session([{ role: "user", text: "¿Cómo pago?" }, { role: "assistant", text: "Ahora: Pulsa Pagar." }]),
    context: ctx("Pago", [
      el("n", "textbox", "Código de seguridad"),
      el("b", "button", "Confirmar pago"),
    ], ["Código de seguridad", "Confirmar pago"]),
    targets: ["Confirmar pago", "Confirmar"],
    kinds: ["explain"],
  },
  // 28. Login: 2FA code
  {
    id: "login-2fa",
    category: "login",
    question: "¿Dónde pongo el código?",
    context: ctx("Verificación", [
      el("c", "textbox", "Código de verificación"),
      el("b", "button", "Verificar"),
    ], ["Código de verificación", "Verificar"]),
    targets: ["Código de verificación", "Verificar"],
    kinds: ["explain"],
  },
  // 29. Large DOM: first action
  {
    id: "large-dom-5",
    category: "large",
    question: "¿Qué botón es el primero que debo pulsar?",
    context: largeContext("Panel de configuración", 130),
    targets: ["button", "Section"],
    kinds: ["explain", "ask_user"],
  },
];

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function judge(c: CaseDef, kind: string | undefined, message: string | undefined): { guidanceCorrect: boolean; unclear: boolean; targetCorrect: boolean } {
  if (!kind || !message) return { guidanceCorrect: false, unclear: false, targetCorrect: false };
  const nk = normalize(kind);
  const kindOk = c.kinds.map(normalize).includes(nk);
  const nm = normalize(message);
  let targetCorrect = false;
  if (c.targets.length === 0) {
    targetCorrect = true;
  } else {
    for (const t of c.targets) {
      if (nm.includes(normalize(t))) { targetCorrect = true; break; }
    }
  }
  if (!kindOk) return { guidanceCorrect: false, unclear: false, targetCorrect: false };
  if (c.targets.length === 0) return { guidanceCorrect: true, unclear: false, targetCorrect: true };
  if (targetCorrect) return { guidanceCorrect: true, unclear: false, targetCorrect: true };
  return { guidanceCorrect: false, unclear: true, targetCorrect: false };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index] ?? 0;
}

async function runModel(model: string, baseUrl: string, apiKey: string): Promise<AbResult[]> {
  const provider = new OpenAICompatibleProvider({ baseUrl, apiKey, model });
  const systemPrompt = buildSystemPrompt();
  const results: AbResult[] = [];
  for (const c of cases) {
    const started = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let httpOutcome: AbResult["httpOutcome"] = "error";
    let latencyMs = 0;
    let raw: string | undefined;
    let kind: string | undefined;
    let message: string | undefined;
    try {
      const resp = await provider.assist({
        mode: "DOM_ONLY",
        question: c.question,
        session: c.session ?? { schemaVersion: 1, sessionId: "ab-session", turns: [] },
        context: c.context,
        systemPrompt,
      }, ctrl.signal);
      latencyMs = Math.round(performance.now() - started);
      raw = resp.raw;
      httpOutcome = "200";
    } catch (e) {
      latencyMs = Math.round(performance.now() - started);
      if (ctrl.signal.aborted || e instanceof Error && e.name === "AbortError") httpOutcome = "timeout";
      else if (e instanceof ProviderHttpError) httpOutcome = "error";
      else httpOutcome = "error";
    } finally {
      clearTimeout(timer);
    }
    let schemaValid = false;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const decision = P0AssistantDecisionSchema.safeParse(parsed);
        if (decision.success) {
          schemaValid = true;
          kind = decision.data.kind;
          message = decision.data.message;
        }
      } catch { /* not json */ }
    }
    const j = judge(c, kind, message);
    results.push({
      model,
      caseId: c.id,
      httpOutcome,
      latencyMs,
      schemaValid,
      guidanceCorrect: schemaValid && j.guidanceCorrect,
      guidanceUnclear: schemaValid && j.unclear,
      targetCorrect: schemaValid && j.targetCorrect,
      kind,
    });
    await new Promise((r) => setTimeout(r, 1200));
  }
  return results;
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

async function main() {
  const config = loadConfig();
  if (!config.nanBaseUrl || !config.nanApiKey) throw new Error("A/B requires a NaN base URL and API key");
  const baseUrl = `${config.nanBaseUrl}/v1`;
  const qwen36 = await runModel("qwen3.6", baseUrl, config.nanApiKey);
  const qwen38 = await runModel("qwen3.8-flash", baseUrl, config.nanApiKey);

  function summarize(model: string, rows: AbResult[]) {
    const lat = rows.map((r) => r.latencyMs);
    return {
      model,
      N: rows.length,
      HTTP_200: rows.filter((r) => r.httpOutcome === "200").length,
      SCHEMA_VALID: rows.filter((r) => r.schemaValid).length,
      SCHEMA_INVALID_OR_NON200: rows.filter((r) => !r.schemaValid).length,
      GUIDANCE_CORRECT: rows.filter((r) => r.guidanceCorrect).length,
      GUIDANCE_UNCLEAR: rows.filter((r) => r.guidanceUnclear).length,
      TARGET_CORRECT: rows.filter((r) => r.targetCorrect).length,
      TIMEOUTS: rows.filter((r) => r.httpOutcome === "timeout").length,
      OTHER_ERRORS: rows.filter((r) => r.httpOutcome === "error").length,
      P50: percentile(lat, 0.5),
      P95: percentile(lat, 0.95),
      MAX: Math.max(...lat),
    };
  }

  const output = {
    CASES: cases.length,
    QWEN36: summarize("qwen3.6", qwen36),
    QWEN38_FLASH: summarize("qwen3.8-flash", qwen38),
    DETAIL: [...qwen36, ...qwen38].map((r) => ({ m: r.model, c: r.caseId, o: r.httpOutcome, ms: r.latencyMs, sv: r.schemaValid, gc: r.guidanceCorrect, gu: r.guidanceUnclear, tc: r.targetCorrect, k: r.kind })),
  };
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch((error) => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  process.stderr.write(error instanceof Error ? `${error.name}: ${error.message}\n` : "ab_failed\n");
  process.exitCode = 1;
});
