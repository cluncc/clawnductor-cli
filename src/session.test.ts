import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs } from './session.js';
import type { SessionConfig } from './types.js';

// ─── Minimum config ───────────────────────────────────────────────────────────

describe('buildArgs minimum config', () => {
  const minConfig: SessionConfig = {
    name: 'test-session',
    cwd: '/tmp',
  };

  it('includes -p flag', () => {
    const args = buildArgs(minConfig);
    assert.ok(args.includes('-p'));
  });

  it('includes --input-format stream-json', () => {
    const args = buildArgs(minConfig);
    const idx = args.indexOf('--input-format');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'stream-json');
  });

  it('includes --output-format stream-json', () => {
    const args = buildArgs(minConfig);
    const idx = args.indexOf('--output-format');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'stream-json');
  });

  it('includes --replay-user-messages', () => {
    const args = buildArgs(minConfig);
    assert.ok(args.includes('--replay-user-messages'));
  });

  it('includes --verbose', () => {
    const args = buildArgs(minConfig);
    assert.ok(args.includes('--verbose'));
  });

  it('includes --include-partial-messages', () => {
    const args = buildArgs(minConfig);
    assert.ok(args.includes('--include-partial-messages'));
  });

  it('defaults --permission-mode to bypassPermissions', () => {
    const args = buildArgs(minConfig);
    const idx = args.indexOf('--permission-mode');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'bypassPermissions');
  });
});

// ─── Model resolution ─────────────────────────────────────────────────────────

describe('buildArgs model', () => {
  it('resolves alias "opus" to full model ID', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp', model: 'opus' });
    const idx = args.indexOf('--model');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'claude-opus-4-7');
  });

  it('resolves alias "sonnet" to full model ID', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp', model: 'sonnet' });
    const idx = args.indexOf('--model');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'claude-sonnet-4-6');
  });

  it('passes through full model ID unchanged', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp', model: 'claude-sonnet-4-6' });
    const idx = args.indexOf('--model');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'claude-sonnet-4-6');
  });

  it('omits --model when not specified', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp' });
    assert.ok(!args.includes('--model'));
  });
});

// ─── Effort ───────────────────────────────────────────────────────────────────

describe('buildArgs effort', () => {
  it('includes --effort high when effort is "high"', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp', effort: 'high' });
    const idx = args.indexOf('--effort');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'high');
  });

  it('does not include --effort when effort is "auto"', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp', effort: 'auto' });
    assert.ok(!args.includes('--effort'));
  });

  it('omits --effort when not specified', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp' });
    assert.ok(!args.includes('--effort'));
  });
});

// ─── maxTurns ─────────────────────────────────────────────────────────────────

describe('buildArgs maxTurns', () => {
  it('includes --max-turns 10 when maxTurns is 10', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp', maxTurns: 10 });
    const idx = args.indexOf('--max-turns');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], '10');
  });

  it('omits --max-turns when not specified', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp' });
    assert.ok(!args.includes('--max-turns'));
  });
});

// ─── appendSystemPrompt ───────────────────────────────────────────────────────

describe('buildArgs appendSystemPrompt', () => {
  it('includes --append-system-prompt with the text', () => {
    const args = buildArgs({
      name: 'test',
      cwd: '/tmp',
      appendSystemPrompt: 'You are helpful.',
    });
    const idx = args.indexOf('--append-system-prompt');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'You are helpful.');
  });

  it('omits --append-system-prompt when not specified', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp' });
    assert.ok(!args.includes('--append-system-prompt'));
  });
});

// ─── resumeSessionId ──────────────────────────────────────────────────────────

describe('buildArgs resumeSessionId', () => {
  it('includes --resume <id>', () => {
    const args = buildArgs({
      name: 'test',
      cwd: '/tmp',
      resumeSessionId: 'abc-123',
    });
    const idx = args.indexOf('--resume');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'abc-123');
  });

  it('includes --fork-session when resumeSessionId + forkSession: true', () => {
    const args = buildArgs({
      name: 'test',
      cwd: '/tmp',
      resumeSessionId: 'abc-123',
      forkSession: true,
    });
    assert.ok(args.includes('--fork-session'));
  });

  it('does not include --fork-session without resumeSessionId', () => {
    const args = buildArgs({
      name: 'test',
      cwd: '/tmp',
      forkSession: true,
    });
    assert.ok(!args.includes('--fork-session'));
  });

  it('omits --resume when not specified', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp' });
    assert.ok(!args.includes('--resume'));
  });
});

// ─── allowedTools / disallowedTools ───────────────────────────────────────────

describe('buildArgs tools', () => {
  it('includes --allowedTools with comma-joined list', () => {
    const args = buildArgs({
      name: 'test',
      cwd: '/tmp',
      allowedTools: ['Bash', 'Read'],
    });
    const idx = args.indexOf('--allowedTools');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'Bash,Read');
  });

  it('includes --disallowedTools with comma-joined list', () => {
    const args = buildArgs({
      name: 'test',
      cwd: '/tmp',
      disallowedTools: ['Write'],
    });
    const idx = args.indexOf('--disallowedTools');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'Write');
  });

  it('omits --allowedTools when empty array', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp', allowedTools: [] });
    assert.ok(!args.includes('--allowedTools'));
  });

  it('omits --disallowedTools when empty array', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp', disallowedTools: [] });
    assert.ok(!args.includes('--disallowedTools'));
  });
});

// ─── mcpConfig ────────────────────────────────────────────────────────────────

describe('buildArgs mcpConfig', () => {
  it('includes single --mcp-config for string value', () => {
    const args = buildArgs({
      name: 'test',
      cwd: '/tmp',
      mcpConfig: '/path/to/config.json',
    });
    const idxs = args
      .map((a, i) => (a === '--mcp-config' ? i : -1))
      .filter((i) => i !== -1);
    assert.equal(idxs.length, 1);
    assert.equal(args[idxs[0] + 1], '/path/to/config.json');
  });

  it('includes two --mcp-config entries for array with two paths', () => {
    const args = buildArgs({
      name: 'test',
      cwd: '/tmp',
      mcpConfig: ['/a/config.json', '/b/config.json'],
    });
    const idxs = args
      .map((a, i) => (a === '--mcp-config' ? i : -1))
      .filter((i) => i !== -1);
    assert.equal(idxs.length, 2);
    assert.equal(args[idxs[0] + 1], '/a/config.json');
    assert.equal(args[idxs[1] + 1], '/b/config.json');
  });

  it('omits --mcp-config when not specified', () => {
    const args = buildArgs({ name: 'test', cwd: '/tmp' });
    assert.ok(!args.includes('--mcp-config'));
  });
});

// ─── permissionMode override ──────────────────────────────────────────────────

describe('buildArgs permissionMode', () => {
  it('uses provided permissionMode', () => {
    const args = buildArgs({
      name: 'test',
      cwd: '/tmp',
      permissionMode: 'acceptEdits',
    });
    const idx = args.indexOf('--permission-mode');
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], 'acceptEdits');
  });
});
