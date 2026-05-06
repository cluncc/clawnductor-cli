/**
 * Disk-based state management for the clawnductor CLI.
 *
 * State directory (default: ~/.clawnductor/) is configurable via
 * CLAWNDUCTOR_STATE_DIR env var or setStateDir() — used by unit tests.
 *
 * All writes use 0o600 file permissions. On POSIX the write is made
 * atomic (write tmp → rename) so concurrent readers never see a partial file.
 * On Windows rename-over-existing fails, so we fall back to a direct write.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type {
  StoredSession,
  EnsembleSession,
  UltraplanResult,
  UltrareviewResult,
} from './types.js';

// ─── State directory ──────────────────────────────────────────────────────────

let _customStateDir: string | undefined;

/** Override the state directory (used by tests). */
export function setStateDir(dir: string): void {
  _customStateDir = dir;
}

export function stateDir(): string {
  return (
    _customStateDir ??
    process.env.CLAWNDUCTOR_STATE_DIR ??
    path.join(homedir(), '.clawnductor')
  );
}

// ─── Derived paths (computed fresh each call so setStateDir takes effect) ─────

function sessionsFile(): string {
  return path.join(stateDir(), 'sessions.json');
}
function ensemblesFile(): string {
  return path.join(stateDir(), 'ensembles.json');
}
function ultraplansFile(): string {
  return path.join(stateDir(), 'ultraplans.json');
}
function ultrareviewsFile(): string {
  return path.join(stateDir(), 'ultrareviews.json');
}
function cuesDir(): string {
  return path.join(stateDir(), 'ensemble-cues');
}

// ─── UUID guard for file-path safety ─────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertSafeId(id: string, label: string): void {
  if (!UUID_RE.test(id)) {
    throw new Error(`Invalid ${label} — must be a UUID (got: ${id})`);
  }
}

// ─── File I/O helpers ─────────────────────────────────────────────────────────

function ensureDir(dir?: string): void {
  fs.mkdirSync(dir ?? stateDir(), { recursive: true, mode: 0o700 });
}

/**
 * Read a JSON file. Returns defaultVal on any error (missing, malformed).
 * The cast is intentional: callers supply a typed defaultVal and the stored
 * data was written by us; a schema mismatch is treated as "empty state".
 */
function readJson<T>(file: string, defaultVal: T): T {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    }
  } catch {
    // Malformed or unreadable → treat as empty
  }
  return defaultVal;
}

/**
 * Atomic-ish write: on POSIX, write to a temp file then rename so readers
 * never see a partial update. On Windows we fall back to a direct write
 * (rename-over-existing throws EPERM there).
 */
function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  const json = JSON.stringify(data, null, 2);

  if (process.platform === 'win32') {
    fs.writeFileSync(file, json, { encoding: 'utf8', mode: 0o600 });
    return;
  }

  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, json, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export function getSessions(): Record<string, StoredSession> {
  return readJson<Record<string, StoredSession>>(sessionsFile(), {});
}

export function getSession(name: string): StoredSession {
  const sessions = getSessions();
  if (!sessions[name]) {
    throw new Error(
      `Session "${name}" not found. Create one with: clawnductor jam start ${name}`,
    );
  }
  return sessions[name];
}

export function saveSession(session: StoredSession): void {
  const sessions = getSessions();
  sessions[session.name] = session;
  writeJson(sessionsFile(), sessions);
}

export function deleteSession(name: string): boolean {
  const sessions = getSessions();
  if (!sessions[name]) return false;
  delete sessions[name];
  writeJson(sessionsFile(), sessions);
  return true;
}

export function sessionExists(name: string): boolean {
  return Boolean(getSessions()[name]);
}

// ─── Ensembles ────────────────────────────────────────────────────────────────

export function getEnsembles(): Record<string, EnsembleSession> {
  return readJson<Record<string, EnsembleSession>>(ensemblesFile(), {});
}

export function getEnsemble(id: string): EnsembleSession | undefined {
  return getEnsembles()[id];
}

export function saveEnsemble(session: EnsembleSession): void {
  const ensembles = getEnsembles();
  ensembles[session.id] = session;
  writeJson(ensemblesFile(), ensembles);
}

// ─── Ensemble cues (file-based IPC for in-flight inject) ─────────────────────

/** Maximum cues held in-flight; prevents unbounded growth. */
const MAX_CUES = 50;

export function queueCue(ensembleId: string, message: string): void {
  assertSafeId(ensembleId, 'ensembleId');
  ensureDir(cuesDir());
  const file = path.join(cuesDir(), `${ensembleId}.json`);

  let cues: string[] = [];
  try {
    if (fs.existsSync(file)) {
      cues = JSON.parse(fs.readFileSync(file, 'utf8')) as string[];
    }
  } catch { /* start fresh if file is corrupt */ }

  if (cues.length >= MAX_CUES) {
    throw new Error(`Too many pending cues for ensemble ${ensembleId} (max ${MAX_CUES})`);
  }

  cues.push(message);
  fs.writeFileSync(file, JSON.stringify(cues), { encoding: 'utf8', mode: 0o600 });
}

export function drainCues(ensembleId: string): string[] {
  assertSafeId(ensembleId, 'ensembleId');
  const file = path.join(cuesDir(), `${ensembleId}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const cues = JSON.parse(fs.readFileSync(file, 'utf8')) as string[];
    fs.unlinkSync(file);
    return Array.isArray(cues) ? cues : [];
  } catch {
    return [];
  }
}

// ─── Ultraplans ───────────────────────────────────────────────────────────────

export function getUltraplans(): Record<string, UltraplanResult> {
  return readJson<Record<string, UltraplanResult>>(ultraplansFile(), {});
}

export function getUltraplan(id: string): UltraplanResult | undefined {
  return getUltraplans()[id];
}

export function saveUltraplan(plan: UltraplanResult): void {
  const plans = getUltraplans();
  plans[plan.id] = plan;
  writeJson(ultraplansFile(), plans);
}

// ─── Ultrareviews ─────────────────────────────────────────────────────────────

export function getUltrareviews(): Record<string, UltrareviewResult> {
  return readJson<Record<string, UltrareviewResult>>(ultrareviewsFile(), {});
}

export function getUltrareview(id: string): UltrareviewResult | undefined {
  return getUltrareviews()[id];
}

export function saveUltrareview(review: UltrareviewResult): void {
  const reviews = getUltrareviews();
  reviews[review.id] = review;
  writeJson(ultrareviewsFile(), reviews);
}
