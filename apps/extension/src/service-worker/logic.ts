/**
 * Stateless request logic for the service worker, isolated from the Chrome API
 * so it can be unit-tested. P0 holds no persistent guidance session, so a
 * service-worker restart cannot corrupt any session state — every request is
 * a fresh, self-contained call to the backend.
 */
import type { AssistResultMessage } from "../shared/messages";
import type { HelpSession, PageContext } from "@guided-web/protocol";

export function buildAssistPayload(
  context: PageContext,
  question: string,
  session: HelpSession,
) {
  return {
    protocolVersion: 3,
    mode: "DOM_ONLY" as const,
    question,
    session,
    context,
  };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function requestAssist(
  backendUrl: string,
  context: PageContext,
  question: string,
  session: HelpSession,
  fetchImpl: FetchLike = fetch,
): Promise<AssistResultMessage> {
  try {
    const res = await fetchImpl(`${backendUrl}/v1/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAssistPayload(context, question, session)),
    });

    const data = (await res.json().catch(() => null)) as
      | { error?: string; decision?: unknown }
      | null;

    if (!res.ok || !data || !data.decision) {
      return { type: "GWA_ASSIST_RESULT", ok: false, error: data?.error ?? "backend_error" };
    }

    return { type: "GWA_ASSIST_RESULT", ok: true, decision: data.decision as never };
  } catch {
    return { type: "GWA_ASSIST_RESULT", ok: false, error: "network" };
  }
}
