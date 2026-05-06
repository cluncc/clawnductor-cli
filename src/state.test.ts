import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  setStateDir,
  getSessions,
  saveSession,
  getSession,
  deleteSession,
  sessionExists,
  saveEnsemble,
  getEnsemble,
  queueCue,
  drainCues,
  saveUltraplan,
  getUltraplan,
} from './state.js';
import type { StoredSession, EnsembleSession, UltraplanResult } from './types.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawnductor-test-'));
}

function makeStoredSession(name = 'test-session'): StoredSession {
  return {
    name,
    config: {
      cwd: '/tmp',
      model: 'claude-sonnet-4-6',
      permissionMode: 'bypassPermissions',
    },
    created: new Date().toISOString(),
    stats: { turns: 0, tokensIn: 0, tokensOut: 0, cachedTokens: 0, costUsd: 0 },
    history: [],
  };
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

function makeEnsembleSession(): EnsembleSession {
  return {
    id: VALID_UUID,
    task: 'test task',
    config: {
      agents: [],
      maxRounds: 5,
      projectDir: '/tmp',
    },
    responses: [],
    status: 'running',
    round: 0,
    startTime: new Date().toISOString(),
  };
}

// ─── State dir isolation ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTmpDir();
  setStateDir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  // Reset to default
  setStateDir(os.tmpdir() + '/clawnductor-reset-' + process.pid);
});

// ─── getSessions ─────────────────────────────────────────────────────────────

describe('getSessions', () => {
  it('returns empty object when sessions file is missing', () => {
    const sessions = getSessions();
    assert.deepEqual(sessions, {});
  });
});

// ─── saveSession + getSession ─────────────────────────────────────────────────

describe('saveSession + getSession', () => {
  it('round-trips a StoredSession correctly', () => {
    const session = makeStoredSession('my-session');
    saveSession(session);

    const loaded = getSession('my-session');
    assert.equal(loaded.name, 'my-session');
    assert.equal(loaded.config.cwd, '/tmp');
    assert.equal(loaded.config.model, 'claude-sonnet-4-6');
  });

  it('overwrites an existing session on re-save', () => {
    const session = makeStoredSession('s1');
    saveSession(session);
    session.config.model = 'opus';
    saveSession(session);

    const loaded = getSession('s1');
    assert.equal(loaded.config.model, 'opus');
  });

  it('throws with helpful message for missing session', () => {
    assert.throws(
      () => getSession('nonexistent'),
      /Session "nonexistent" not found/,
    );
  });

  it('includes jam start hint in error message', () => {
    assert.throws(
      () => getSession('missing'),
      /jam start/,
    );
  });
});

// ─── deleteSession ────────────────────────────────────────────────────────────

describe('deleteSession', () => {
  it('returns true and removes existing session', () => {
    saveSession(makeStoredSession('to-delete'));
    const result = deleteSession('to-delete');
    assert.equal(result, true);
    assert.equal(sessionExists('to-delete'), false);
  });

  it('returns false for missing session', () => {
    const result = deleteSession('ghost');
    assert.equal(result, false);
  });
});

// ─── sessionExists ────────────────────────────────────────────────────────────

describe('sessionExists', () => {
  it('returns true after save', () => {
    saveSession(makeStoredSession('exists'));
    assert.equal(sessionExists('exists'), true);
  });

  it('returns false after delete', () => {
    saveSession(makeStoredSession('gone'));
    deleteSession('gone');
    assert.equal(sessionExists('gone'), false);
  });

  it('returns false when session was never created', () => {
    assert.equal(sessionExists('never'), false);
  });
});

// ─── saveEnsemble + getEnsemble ───────────────────────────────────────────────

describe('saveEnsemble + getEnsemble', () => {
  it('round-trips an EnsembleSession correctly', () => {
    const ens = makeEnsembleSession();
    saveEnsemble(ens);

    const loaded = getEnsemble(VALID_UUID);
    assert.ok(loaded);
    assert.equal(loaded.id, VALID_UUID);
    assert.equal(loaded.task, 'test task');
    assert.equal(loaded.status, 'running');
  });

  it('returns undefined for missing ensemble', () => {
    const loaded = getEnsemble('00000000-0000-0000-0000-000000000001');
    assert.equal(loaded, undefined);
  });
});

// ─── queueCue + drainCues ─────────────────────────────────────────────────────

describe('queueCue + drainCues', () => {
  it('queues a message and drain returns it', () => {
    queueCue(VALID_UUID, 'hello cue');
    const cues = drainCues(VALID_UUID);
    assert.deepEqual(cues, ['hello cue']);
  });

  it('drain removes the cue file so second drain returns []', () => {
    queueCue(VALID_UUID, 'once only');
    drainCues(VALID_UUID);
    const second = drainCues(VALID_UUID);
    assert.deepEqual(second, []);
  });

  it('drain on missing file returns []', () => {
    const cues = drainCues(VALID_UUID);
    assert.deepEqual(cues, []);
  });

  it('queues multiple messages in order', () => {
    queueCue(VALID_UUID, 'first');
    queueCue(VALID_UUID, 'second');
    queueCue(VALID_UUID, 'third');
    const cues = drainCues(VALID_UUID);
    assert.deepEqual(cues, ['first', 'second', 'third']);
  });

  it('throws on invalid UUID', () => {
    assert.throws(() => queueCue('not-a-uuid', 'msg'), /Invalid ensembleId/);
  });

  it('throws when MAX_CUES (50) is exceeded', () => {
    for (let i = 0; i < 50; i++) {
      queueCue(VALID_UUID, `cue ${i}`);
    }
    assert.throws(
      () => queueCue(VALID_UUID, 'one too many'),
      /Too many pending cues/,
    );
  });
});

// ─── drainCues with corrupt file ─────────────────────────────────────────────

describe('drainCues corrupt file', () => {
  it('returns [] when cue file contains invalid JSON', () => {
    // Write a corrupt cue file directly
    const cuesDir = path.join(tmpDir, 'ensemble-cues');
    fs.mkdirSync(cuesDir, { recursive: true });
    const cueFile = path.join(cuesDir, `${VALID_UUID}.json`);
    fs.writeFileSync(cueFile, 'THIS IS NOT JSON', 'utf8');

    const result = drainCues(VALID_UUID);
    assert.deepEqual(result, []);
  });
});

// ─── saveUltraplan + getUltraplan ─────────────────────────────────────────────

describe('saveUltraplan + getUltraplan', () => {
  it('round-trips a UltraplanResult correctly', () => {
    const plan: UltraplanResult = {
      id: VALID_UUID,
      status: 'completed',
      sessionName: 'overture-test',
      startTime: new Date().toISOString(),
      plan: '# My Plan\n\n- [ ] do something',
    };
    saveUltraplan(plan);

    const loaded = getUltraplan(VALID_UUID);
    assert.ok(loaded);
    assert.equal(loaded.id, VALID_UUID);
    assert.equal(loaded.status, 'completed');
    assert.equal(loaded.plan, '# My Plan\n\n- [ ] do something');
  });

  it('returns undefined for missing ultraplan', () => {
    const loaded = getUltraplan('00000000-0000-0000-0000-000000000002');
    assert.equal(loaded, undefined);
  });
});

// ─── writeJson atomicity ──────────────────────────────────────────────────────

describe('writeJson atomicity', () => {
  it('no tmp file remains after save (POSIX rename-based write)', () => {
    if (process.platform === 'win32') return; // POSIX only

    const session = makeStoredSession('atomic-test');
    saveSession(session);

    // The tmp file (with .PID.tmp suffix) should be gone
    const sessionsPath = path.join(tmpDir, 'sessions.json');
    const tmpPattern = `${sessionsPath}.${process.pid}.tmp`;
    assert.equal(fs.existsSync(tmpPattern), false);

    // The sessions file itself should exist
    assert.equal(fs.existsSync(sessionsPath), true);
  });

  it('sessions file is valid JSON after write', () => {
    saveSession(makeStoredSession('json-check'));
    const sessionsPath = path.join(tmpDir, 'sessions.json');
    const content = fs.readFileSync(sessionsPath, 'utf8');
    const parsed = JSON.parse(content);
    assert.ok(typeof parsed === 'object' && parsed !== null);
    assert.ok('json-check' in parsed);
  });
});
