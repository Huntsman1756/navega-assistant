/**
 * Safe provider failure classifications shared by adapters and the backend.
 * Error messages intentionally contain no upstream response body.
 */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(`Provider request failed with HTTP ${status}`);
    this.name = "ProviderHttpError";
  }
}

export class ProviderConnectionError extends Error {
  constructor(cause?: unknown) {
    super("Provider connection failed", cause instanceof Error ? { cause } : undefined);
    this.name = "ProviderConnectionError";
  }
}

/** A successful upstream HTTP response did not contain usable model content. */
export class ProviderOutputError extends Error {
  constructor() {
    super("Provider returned invalid model output");
    this.name = "ProviderOutputError";
  }
}
