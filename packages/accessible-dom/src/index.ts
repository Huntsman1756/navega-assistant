export { extractAccessibleDOMSnapshot } from "./extractor";
export type { ExtractOptions } from "./extractor";
export { classifySecretField, shouldExcludeElement, isHidden, redactSensitiveRuns } from "./sanitizer";
export type { SecretFieldKind } from "./sanitizer";
export { iterElements, collectElements } from "./traversal";
export { orderCandidates, scoreCandidate, DEFAULT_BUDGETS } from "./relevance";
export type { CandidateAnalysis, BudgetSettings, RankedCandidate } from "./relevance";
export { buildPageContext, boundContext, MAX_FRAMES } from "./frames";
export type { FrameInput } from "./frames";
