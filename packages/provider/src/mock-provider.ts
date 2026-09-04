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
    const { snapshot } = request;

    const firstActionable = snapshot.elements.find(
      (el) =>
        el.interactive &&
        (el.role === "button" || el.tag.toLowerCase() === "button") &&
        el.accessibleName,
    );

    if (firstActionable?.accessibleName) {
      return {
        kind: "explain",
        message: `Press "${firstActionable.accessibleName}".`,
      };
    }

    const hasPassword = snapshot.elements.some(
      (el) => el.role === "textbox" && (el.state?.empty === false || el.state?.empty === true),
    );

    if (hasPassword) {
      return {
        kind: "explain",
        message:
          "This field asks for your password. Enter it directly on the website. Do not tell me your password.",
      };
    }

    return {
      kind: "ask_user",
      message: "What would you like to do on this page?",
    };
  }
}
