import * as path from 'node:path';

// ─── Limits ───────────────────────────────────────────────────────────────────

export const MAX_NAME_LENGTH = 100;
export const MAX_AGENT_NAME_LENGTH = 50;
export const MAX_CWD_LENGTH = 500;
export const MAX_REGEX_LENGTH = 500;
export const MAX_STRING_FIELD_LENGTH = 50_000;
export const MAX_TIMEOUT_MS = 24 * 60 * 60_000; // 24 h
export const MIN_TIMEOUT_MS = 1_000;             // 1 s

// ─── Patterns ─────────────────────────────────────────────────────────────────

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Tool names: alphanumeric + underscore/colon/hyphen, optional trailing wildcard.
// Covers: Bash, Read, mcp__server__tool, bash:run, mcp__*
const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_:*-]*$|^\*$/;
// Model IDs: claude-opus-4-7, claude-sonnet-4-6, opus, sonnet, haiku, etc.
const MODEL_RE = /^[A-Za-z0-9._:-]+$/;

const VALID_PERMISSION_MODES = new Set([
  'bypassPermissions',
  'acceptEdits',
  'auto',
  'plan',
]);
const VALID_EFFORT_LEVELS = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'auto',
]);

// System paths that are never valid cwds for a coding agent.
const FORBIDDEN_PATH_PREFIXES: string[] =
  process.platform === 'win32'
    ? [] // Windows doesn't have /proc, /sys etc.
    : ['/proc', '/sys', '/dev', '/run/user'];

// ─── Name / ID validators ─────────────────────────────────────────────────────

export function validateName(value: unknown, field = 'name'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const v = value.trim();
  if (!v) throw new Error(`${field} cannot be empty`);
  if (v.length > MAX_NAME_LENGTH)
    throw new Error(`${field} must be ≤${MAX_NAME_LENGTH} characters`);
  if (!NAME_RE.test(v))
    throw new Error(
      `${field} contains invalid characters (allowed: A-Z a-z 0-9 . _ -)`,
    );
  return v;
}

export function validateAgentName(value: unknown, field = 'agent name'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const v = value.trim();
  if (!v) throw new Error(`${field} cannot be empty`);
  if (v.length > MAX_AGENT_NAME_LENGTH)
    throw new Error(`${field} must be ≤${MAX_AGENT_NAME_LENGTH} characters`);
  if (!AGENT_NAME_RE.test(v))
    throw new Error(
      `${field} must match [A-Za-z0-9][A-Za-z0-9-]* (safe for git branch names)`,
    );
  return v;
}

/** Validate a UUID (v4 or any version) used as an opaque record identifier. */
export function validateId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (!UUID_RE.test(value.trim()))
    throw new Error(`${field} must be a valid UUID`);
  return value.trim();
}

// ─── Path validator ───────────────────────────────────────────────────────────

export function validateCwd(value: unknown, field = 'cwd'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (!value.trim()) throw new Error(`${field} cannot be empty`);
  if (value.length > MAX_CWD_LENGTH)
    throw new Error(`${field} exceeds maximum path length`);
  const resolved = path.resolve(value);
  for (const forbidden of FORBIDDEN_PATH_PREFIXES) {
    if (resolved === forbidden || resolved.startsWith(forbidden + path.sep)) {
      throw new Error(`${field} points to a forbidden system path: ${resolved}`);
    }
  }
  return resolved;
}

// ─── Regex validator ──────────────────────────────────────────────────────────

export function validateRegex(value: unknown, field = 'pattern'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (value.length > MAX_REGEX_LENGTH)
    throw new Error(`${field} must be ≤${MAX_REGEX_LENGTH} characters`);

  try {
    new RegExp(value);
  } catch (e) {
    throw new Error(
      `${field} is not a valid regex: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Reject patterns that are known to cause catastrophic backtracking:
  // nested quantifiers, quantified alternations over the same characters, etc.
  if (
    /(\+\+|\*\*|\{[^}]+\}\s*[+*]|\([^)]*[+*][^)]*\)\s*[+*{])/.test(value)
  ) {
    throw new Error(
      `${field} contains a nested quantifier that could cause catastrophic backtracking`,
    );
  }
  // Quantified groups containing alternation — (a|ab)* style
  if (/\([^)]*\|[^)]*\)[+*{]/.test(value)) {
    throw new Error(
      `${field} contains a quantified alternation group that could cause catastrophic backtracking`,
    );
  }

  return value;
}

// ─── Enum validators ──────────────────────────────────────────────────────────

export function validatePermissionMode(
  value: unknown,
  field = 'permissionMode',
): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (!VALID_PERMISSION_MODES.has(value))
    throw new Error(
      `${field} must be one of: ${[...VALID_PERMISSION_MODES].join(', ')}`,
    );
  return value;
}

export function validateEffort(value: unknown, field = 'effort'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (!VALID_EFFORT_LEVELS.has(value))
    throw new Error(
      `${field} must be one of: ${[...VALID_EFFORT_LEVELS].join(', ')}`,
    );
  return value;
}

// ─── Numeric validators ───────────────────────────────────────────────────────

export function validateTimeout(value: unknown, field = 'timeout'): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${field} must be a finite number`);
  if (value < MIN_TIMEOUT_MS)
    throw new Error(`${field} must be ≥${MIN_TIMEOUT_MS}ms`);
  if (value > MAX_TIMEOUT_MS)
    throw new Error(`${field} must be ≤${MAX_TIMEOUT_MS}ms`);
  return value;
}

export function validatePositiveInt(
  value: unknown,
  field: string,
  max?: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    throw new Error(`${field} must be a positive integer`);
  if (max !== undefined && value > max)
    throw new Error(`${field} must be ≤${max}`);
  return value;
}

// ─── String field validator ───────────────────────────────────────────────────

export function validateStringField(
  value: unknown,
  field: string,
  maxLength = MAX_STRING_FIELD_LENGTH,
): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (!value.trim()) throw new Error(`${field} cannot be empty`);
  if (value.length > maxLength)
    throw new Error(`${field} must be ≤${maxLength} characters`);
  return value;
}

// ─── Tool name validator ──────────────────────────────────────────────────────

/**
 * Validates a single Claude tool name. Tool names come from user-supplied
 * --allow / --disallow flags and are forwarded to the Claude binary via
 * --allowedTools. Restricting characters prevents argument injection.
 */
export function validateToolName(value: unknown, field = 'tool name'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const v = value.trim();
  if (!v) throw new Error(`${field} cannot be empty`);
  if (v.length > 100) throw new Error(`${field} must be ≤100 characters`);
  if (!TOOL_NAME_RE.test(v))
    throw new Error(
      `${field} "${v}" contains invalid characters (allowed: A-Z a-z 0-9 _ : - *)`,
    );
  return v;
}

// ─── Model validator ──────────────────────────────────────────────────────────

/**
 * Validates a model name or alias. Prevents injection through model strings
 * forwarded to `claude --model`.
 */
export function validateModel(value: unknown, field = 'model'): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const v = value.trim();
  if (!v) throw new Error(`${field} cannot be empty`);
  if (v.length > 100) throw new Error(`${field} must be ≤100 characters`);
  if (!MODEL_RE.test(v))
    throw new Error(
      `${field} "${v}" contains invalid characters (allowed: A-Z a-z 0-9 . _ : -)`,
    );
  return v;
}
