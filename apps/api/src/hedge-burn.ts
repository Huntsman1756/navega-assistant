import { loadConfig } from "./config";
import { createApp } from "./routes";
import type { ProviderAttemptObservation } from "./provider-retry";
import type { PageContext } from "@guided-web/protocol";

type BurnRow = {
  totalMs: number;
  hedged: boolean;
  winner: "A" | "B" | "none";
  timeout: boolean;
  invalidOutput: boolean;
  otherFailure: boolean;
  observations: ProviderAttemptObservation[];
  invalidA: number;
  invalidB: number;
  recovered: boolean;
};

function element(i: number, kind: "tiny" | "medium" | "large") {
  const roles = kind === "large"
    ? ["heading", "button", "link", "textbox", "combobox"]
    : ["button", "textbox", "link"];
  const role = roles[i % roles.length];
  return {
    id: `el-${kind}-${i}`,
    tag: role === "textbox" ? "input" : role === "heading" ? "h2" : role === "link" ? "a" : "button",
    role,
    accessibleName: role === "heading" ? `Section ${i}` : `${role} ${i}`,
    interactive: role !== "heading",
    ...(i === 0 ? { state: { focused: true } } : {}),
  };
}

function context(kind: "tiny" | "medium" | "large"): PageContext {
  const count = kind === "tiny" ? 5 : kind === "medium" ? 36 : 130;
  const snapshot = {
    schemaVersion: 1 as const,
    snapshotId: `burn-${kind}`,
    page: {
      url: `https://fixture.invalid/${kind}`,
      origin: "https://fixture.invalid",
      title: kind === "tiny" ? "Sign in" : kind === "medium" ? "Account form" : "Help article",
    },
    elements: Array.from({ length: count }, (_, i) => element(i, kind)),
    visibleText: kind === "tiny"
      ? ["Sign in", "Username", "Password"]
      : kind === "medium"
        ? ["Complete the form", "Required fields", "Continue"]
        : Array.from({ length: 20 }, (_, i) => `Article paragraph ${i}`),
    truncated: kind === "large" ? true : undefined,
  };
  return {
    schemaVersion: 1,
    topFrameId: 0,
    frames: [{
      frameId: 0,
      parentFrameId: -1,
      origin: "https://fixture.invalid",
      accessible: true,
      snapshot,
    }],
  };
}

const contexts = {
  tiny: context("tiny"),
  medium: context("medium"),
  large: context("large"),
} as const;
const questions = {
  tiny: "No sé cómo iniciar sesión.",
  medium: "¿Qué hago en este formulario?",
  large: "¿Qué debo hacer en esta página?",
} as const;
const session = { schemaVersion: 1 as const, sessionId: "burn-session", turns: [] };

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index] ?? 0;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

try {
  const config = loadConfig();
  if (config.providerName !== "openai-compatible" || config.model !== "qwen3.6") {
    throw new Error("burn requires AI_PROVIDER=openai-compatible and AI_MODEL=qwen3.6");
  }

  let current: BurnRow | undefined;
  const app = createApp(config.provider, config.providerName, config.model, {
    providerTimeoutMs: 8000,
    providerTotalTimeoutMs: 12000,
    hedgeDelayMs: 4000,
    nanConfig: {
      ttsEndpoint: config.ttsEndpoint,
      sttEndpoint: config.sttEndpoint,
      apiKey: config.nanApiKey,
    },
    onProviderAttemptComplete: (observation) => current?.observations.push(observation),
  });

  const rows: BurnRow[] = [];
  for (let i = 0; i < 100; i += 1) {
    const kind = i % 3 === 0 ? "tiny" : i % 3 === 1 ? "medium" : "large";
    const started = performance.now();
    current = {
      totalMs: 0,
      hedged: false,
      winner: "none",
      timeout: false,
      invalidOutput: false,
      otherFailure: false,
      observations: [],
      invalidA: 0,
      invalidB: 0,
      recovered: false,
    };
    const response = await app.request("/v1/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 3,
        mode: "DOM_ONLY",
        question: questions[kind],
        context: contexts[kind],
        session,
      }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    current.totalMs = Math.round(performance.now() - started);
    current.hedged = current.observations.some((observation) => observation.attempt === 2);
    const winner = current.observations.find((observation) => observation.retryReason === "none");
    current.winner = winner?.attempt === 2 ? "B" : winner?.attempt === 1 ? "A" : "none";
    current.timeout = body.error === "provider_timeout";
    current.invalidOutput = body.error === "invalid_model_output";
    current.otherFailure = response.status !== 200 && !current.timeout && !current.invalidOutput;
    current.invalidA = current.observations.filter((o) => o.attempt === 1 && (o.retryReason === "invalid_model_output" || o.retryReason === "validation_failed")).length;
    current.invalidB = current.observations.filter((o) => o.attempt === 2 && (o.retryReason === "invalid_model_output" || o.retryReason === "validation_failed")).length;
    current.recovered = current.invalidA > 0 && current.invalidB === 0 && !current.timeout && !current.invalidOutput;
    rows.push(current);
    current = undefined;
    if (i < 99) await pause(2000);
  }

  const durations = rows.map((row) => row.totalMs);
  const totalInvalidA = rows.reduce((s, r) => s + r.invalidA, 0);
  const totalInvalidB = rows.reduce((s, r) => s + r.invalidB, 0);
  const totalRecovered = rows.filter((r) => r.recovered).length;
  const output = {
    LOGICAL_N: rows.length,
    HEDGES_LAUNCHED: rows.filter((row) => row.hedged).length,
    HEDGE_RATE: `${((rows.filter((row) => row.hedged).length / rows.length) * 100).toFixed(1)}%`,
    INVALID_PHYSICAL_A: totalInvalidA,
    INVALID_PHYSICAL_B: totalInvalidB,
    INVALID_RECOVERED_BY_ALTERNATE: totalRecovered,
    A_WINS: rows.filter((row) => row.winner === "A").length,
    B_WINS: rows.filter((row) => row.winner === "B").length,
    USER_VISIBLE_TIMEOUTS: rows.filter((row) => row.timeout).length,
    OTHER_FAILURES: rows.filter((row) => row.otherFailure).length,
    INVALID_MODEL_OUTPUT: rows.filter((row) => row.invalidOutput).length,
    P50: percentile(durations, 0.5),
    P95: percentile(durations, 0.95),
    MAX: Math.max(...durations),
  };
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  process.stdout.write(`${JSON.stringify(output)}\n`);
} catch (error) {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  process.stderr.write(error instanceof Error ? `${error.name}\n` : "burn_failed\n");
  process.exitCode = 1;
}
