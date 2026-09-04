import type { AIProvider, AssistModelRequest, AssistModelResponse } from "./types";

/**
 * Deterministic provider that requires no external AI access.
 *
 * It inspects the sanitized snapshot and returns a single, safe, structured
 * instruction. Used for tests, CI, offline local development and the P0
 * demonstration vertical slice. It MUST NOT be used to claim model quality.
 */
export class MockProvider implements AIProvider {
  readonly name = "mock";

  async assist(request: AssistModelRequest, _signal?: AbortSignal): Promise<AssistModelResponse> {
    const decision = this.decide(request);
    return { raw: JSON.stringify(decision), provider: this.name, model: "mock" };
  }

  private decide(request: AssistModelRequest): {
    kind: "explain" | "ask_user" | "cannot_help";
    message: string;
    reason?: string;
  } {
    const { snapshot, session } = request;

    // Deterministic continuity signal: when there is prior conversation the
    // mock acknowledges the current help task, so automated tests can verify the
    // backend really forwarded the recent conversation to the model.
    const hasContext = !!session && Array.isArray(session.turns) && session.turns.length > 0;
    const prefix = hasContext ? "Sigamos. " : "";

    const firstActionable = snapshot.elements.find(
      (el) =>
        el.interactive &&
        (el.role === "button" || el.tag.toLowerCase() === "button") &&
        el.accessibleName,
    );

    if (firstActionable?.accessibleName) {
      return {
        kind: "explain",
        message: `${prefix}Pulsa "${firstActionable.accessibleName}".`,
      };
    }

    const hasPassword = snapshot.elements.some(
      (el) => el.role === "textbox" && (el.state?.empty === false || el.state?.empty === true),
    );

    if (hasPassword) {
      return {
        kind: "explain",
        message:
          "Este campo pide tu contraseña. Escríbela directamente en el sitio web. No me digas tu contraseña.",
      };
    }

    return {
      kind: "ask_user",
      message: `${prefix}¿Qué quieres hacer en esta página?`,
    };
  }
}
