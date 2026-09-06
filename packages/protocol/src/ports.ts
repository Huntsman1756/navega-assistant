/**
 * Deterministic port constants.
 *
 * - OPERATOR_API_PORT: default port for the self-hostable backend operator.
 * - E2E_API_PORT:       port for the E2E mock backend (must NEVER equal OPERATOR_API_PORT).
 *
 * E2E tests import E2E_API_PORT and never reference OPERATOR_API_PORT directly.
 * Comments and documentation may mention either port without affecting CI.
 */
export const OPERATOR_API_PORT = 8787;
export const E2E_API_PORT = 18787;