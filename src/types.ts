export type PermissionMode = 'bypassPermissions' | 'acceptEdits' | 'auto' | 'plan';
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

export const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

export function resolveModelAlias(model: string): string {
  return MODEL_ALIASES[model.toLowerCase()] ?? model;
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface SessionConfig {
  name: string;
  cwd: string;
  model?: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  appendSystemPrompt?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  mcpConfig?: string | string[];
}

export interface SessionStats {
  turns: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  isReady: boolean;
  busy: boolean;
  startTime: string | null;
  lastActivity: string | null;
  contextPercent: number;
  retries: number;
  lastRetryError?: string;
  lastOutput?: string;
  lastError?: string;
}

export interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface SendResult {
  output: string;
  sessionId?: string;
  error?: string;
  events: StreamEvent[];
}

// ─── CLI state ─────────────────────────────────────────────────────────────────

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface StoredSessionStats {
  turns: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
}

export interface StoredSession {
  name: string;
  claudeSessionId?: string;
  config: {
    cwd: string;
    claudeBin?: string;
    model?: string;
    permissionMode?: PermissionMode;
    effort?: EffortLevel;
    allowedTools?: string[];
    disallowedTools?: string[];
    maxTurns?: number;
    appendSystemPrompt?: string;
    mcpConfig?: string[];
  };
  created: string;
  lastActivity?: number;
  stats?: StoredSessionStats;
  history?: StoredMessage[];
}

// ─── Ensemble ─────────────────────────────────────────────────────────────────

export interface AgentPersona {
  name: string;
  emoji: string;
  persona: string;
  model?: string;
  permissionMode?: PermissionMode;
}

export interface EnsembleConfig {
  agents: AgentPersona[];
  maxRounds: number;
  projectDir: string;
  agentTimeoutMs?: number;
  maxTurnsPerAgent?: number;
  maxBudgetUsd?: number;
  defaultPermissionMode?: PermissionMode;
}

export interface AgentResponse {
  agent: string;
  round: number;
  content: string;
  consensus: boolean;
  timestamp: string;
}

export type EnsembleStatus =
  | 'running'
  | 'consensus'
  | 'max_rounds'
  | 'error'
  | 'accepted'
  | 'rejected'
  | 'abandoned';

export interface EnsembleSession {
  id: string;
  task: string;
  config: EnsembleConfig;
  responses: AgentResponse[];
  status: EnsembleStatus;
  round: number;
  startTime: string;
  endTime?: string;
  error?: string;
  agentPids?: Record<string, number>;
  _cliPid?: number;
}

export interface EnsembleChangedFile {
  file: string;
  insertions: number;
  deletions: number;
}

export interface EnsembleReviewResult {
  ensembleId: string;
  projectDir: string;
  status: EnsembleStatus;
  rounds: number;
  planExists: boolean;
  planContent?: string;
  changedFiles: EnsembleChangedFile[];
  branches: string[];
  worktrees: string[];
  agentSummaries: Array<{ agent: string; consensus: boolean; preview: string }>;
}

export interface EnsembleAcceptResult {
  ensembleId: string;
  branchesDeleted: string[];
  worktreesRemoved: string[];
  planDeleted: boolean;
}

export interface EnsembleRejectResult {
  ensembleId: string;
  planRewritten: boolean;
  feedback: string;
}

// ─── Ultraplan / Ultrareview ──────────────────────────────────────────────────

export interface UltraplanResult {
  id: string;
  status: 'running' | 'completed' | 'error' | 'timeout';
  plan?: string;
  sessionName: string;
  startTime: string;
  endTime?: string;
  error?: string;
}

export interface UltrareviewResult {
  id: string;
  status: 'running' | 'completed' | 'error';
  ensembleId: string;
  findings?: string;
  agentCount: number;
  startTime: string;
  endTime?: string;
  error?: string;
}

// ─── AgentInfo ────────────────────────────────────────────────────────────────

export interface AgentInfo {
  name: string;
  file: string;
  description: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const CONTEXT_WINDOW_TOKENS = 200_000;
export const SESSION_READY_TIMEOUT_MS = 20_000;
export const TURN_TIMEOUT_MS = 300_000;
export const COMPACT_TIMEOUT_MS = 120_000;
export const STOP_SIGKILL_DELAY_MS = 3_000;
export const MAX_HISTORY_EVENTS = 500;
export const MAX_STORED_MESSAGES = 100;

export const DEFAULT_MAX_ROUNDS = 15;
export const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_MAX_TURNS_PER_AGENT = 30;
export const INTER_ROUND_DELAY_MS = 2_000;
export const GIT_CMD_TIMEOUT_MS = 30_000;
export const WORKTREE_DIR = '.worktrees';

export const ULTRAPLAN_TIMEOUT_MS = 30 * 60_000;

export const ULTRAPLAN_SYSTEM_PROMPT = `You are a deep technical planner. Your only job is to produce a thorough implementation plan.

Rules:
- Explore the codebase exhaustively before writing the plan
- Check existing files, dependencies, test patterns, and architectural conventions
- Output ONLY the plan — no code changes, no implementations
- Use markdown with ## sections and - [ ] checkbox task lists
- Include: overview, architecture decisions, task breakdown, testing strategy, edge cases, risks
- Be specific enough that a separate implementation agent can execute each task without questions`;

export const REVIEWER_FLEET: Array<{ name: string; emoji: string; focus: string }> = [
  { name: 'SecurityReviewer', emoji: '🔒', focus: 'Injection attacks, auth flaws, data exposure, OWASP top 10, secrets in code' },
  { name: 'LogicReviewer', emoji: '🧩', focus: 'Off-by-one errors, race conditions, null/undefined handling, edge case logic' },
  { name: 'PerformanceReviewer', emoji: '⚡', focus: 'O(n²) loops, memory leaks, missing caching, N+1 queries, blocking I/O' },
  { name: 'APIReviewer', emoji: '🔌', focus: 'Inconsistent interfaces, missing validation, error response gaps, breaking changes' },
  { name: 'TestReviewer', emoji: '🧪', focus: 'Untested code paths, missing edge case tests, flaky test patterns, assert quality' },
  { name: 'TypeReviewer', emoji: '📐', focus: 'Unsafe type casts, any/unknown misuse, missing null checks, type widening bugs' },
  { name: 'ConcurrencyReviewer', emoji: '🔄', focus: 'Race conditions, deadlocks, unhandled async errors, shared mutable state' },
  { name: 'ErrorReviewer', emoji: '💥', focus: 'Swallowed errors, missing try/catch, silent failures, crash paths' },
  { name: 'DependencyReviewer', emoji: '📦', focus: 'Outdated packages, known CVEs, unnecessary dependencies, license issues' },
  { name: 'ReadabilityReviewer', emoji: '📖', focus: 'Unclear naming, overly complex functions, dead code, misleading comments' },
  { name: 'DataReviewer', emoji: '🗄️', focus: 'Input validation gaps, schema mismatches, encoding bugs, data truncation' },
  { name: 'ConfigReviewer', emoji: '⚙️', focus: 'Hardcoded values, missing env vars, insecure defaults, config injection' },
  { name: 'ScalabilityReviewer', emoji: '📈', focus: 'Single points of failure, unbounded data growth, missing pagination' },
  { name: 'DocReviewer', emoji: '📝', focus: 'Outdated documentation, missing API docs, misleading examples' },
  { name: 'NetworkReviewer', emoji: '🌐', focus: 'Missing timeouts, no retry logic, connection leaks, unvalidated URLs' },
  { name: 'AuthReviewer', emoji: '🗝️', focus: 'Token handling, CSRF, session fixation, privilege escalation, RBAC gaps' },
  { name: 'CryptoReviewer', emoji: '🔐', focus: 'Weak algorithms, hardcoded keys, improper RNG, padding oracle risks' },
  { name: 'MemoryReviewer', emoji: '🧠', focus: 'Memory leaks, circular references, buffer overflows, stream backpressure' },
  { name: 'A11yReviewer', emoji: '♿', focus: 'Missing ARIA labels, keyboard navigation gaps, color contrast, screen reader support' },
  { name: 'I18nReviewer', emoji: '🌍', focus: 'Hardcoded strings, locale handling bugs, RTL layout, date/number formatting' },
];

export const DEFAULT_AGENT_POOL: Array<{ name: string; emoji: string; persona: string }> = [
  { name: 'Aria', emoji: '🎯', persona: 'Senior full-stack engineer focused on clean architecture and correctness' },
  { name: 'Byte', emoji: '⚡', persona: 'Performance engineer focused on efficiency, profiling, and optimization' },
  { name: 'Cedar', emoji: '🌲', persona: 'QA engineer focused on testing, edge cases, and reliability' },
  { name: 'Drift', emoji: '🌊', persona: 'Security engineer focused on vulnerabilities and safe coding practices' },
  { name: 'Echo', emoji: '🔮', persona: 'Systems engineer focused on scalability, fault tolerance, and observability' },
  { name: 'Flux', emoji: '🔁', persona: 'Refactoring specialist focused on code quality, SOLID principles, and maintainability' },
  { name: 'Glyph', emoji: '📜', persona: 'Documentation and API design specialist' },
  { name: 'Haze', emoji: '🌫️', persona: 'Integration engineer focused on external dependencies, APIs, and data flows' },
];
