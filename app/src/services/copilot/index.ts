// Public API barrel — all imports from '../services/copilot' continue to work
// as TypeScript resolves `services/copilot` → `services/copilot.ts` (the original
// file, now replaced) → this index is exported from the split sub-files.

export type { ModelTokenBudgets } from './tokenBudget';
export {
  getModelTokenBudgets,
  estimateTokens,
  getCompressionAnchorUserText,
} from './tokenBudget';

export { sanitizeLoop } from './messages';

export type { DeviceFlowState } from './auth';
export { getStoredOAuthToken, clearOAuthToken, startDeviceFlow } from './auth';

export {
  isChatCompletionsCompatibleModel,
  filterChatCompletionsCompatibleModels,
  resolveCopilotModelForChatCompletions,
  modelSupportsVision,
  modelApiParams,
  isBlockedModel,
  familyKey,
  fetchCopilotModels,
} from './models';

export type { RateLimitInfo } from './diagnostics';
export {
  CopilotDiagnosticError,
  getLastRequestDump,
  getLastRateLimit,
  isQuotaError,
} from './diagnostics';

export {
  streamCopilotChat,
  copilotComplete,
  fetchGhostCompletion,
  runCopilotAgent,
} from './streaming';
