import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateName,
  validateAgentName,
  validateId,
  validateCwd,
  validateRegex,
  validatePermissionMode,
  validateEffort,
  validateTimeout,
  validatePositiveInt,
  validateStringField,
  validateToolName,
  validateModel,
  MAX_NAME_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  MAX_CWD_LENGTH,
  MAX_REGEX_LENGTH,
  MAX_STRING_FIELD_LENGTH,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
} from './validation.js';

// ─── validateName ─────────────────────────────────────────────────────────────

describe('validateName', () => {
  it('accepts alphanumeric names', () => {
    assert.equal(validateName('mySession123'), 'mySession123');
  });

  it('accepts names with dots, underscores, and hyphens', () => {
    assert.equal(validateName('my.session_name-1'), 'my.session_name-1');
  });

  it('trims surrounding whitespace', () => {
    assert.equal(validateName('  myName  '), 'myName');
  });

  it('throws on empty string', () => {
    assert.throws(() => validateName(''), /cannot be empty/);
  });

  it('throws on whitespace-only string', () => {
    assert.throws(() => validateName('   '), /cannot be empty/);
  });

  it('throws when name exceeds max length', () => {
    assert.throws(
      () => validateName('a'.repeat(MAX_NAME_LENGTH + 1)),
      /must be ≤/,
    );
  });

  it('throws on invalid characters (space)', () => {
    assert.throws(() => validateName('my session'), /invalid characters/);
  });

  it('throws on invalid characters ($)', () => {
    assert.throws(() => validateName('my$session'), /invalid characters/);
  });

  it('throws when value is not a string', () => {
    assert.throws(() => validateName(42 as unknown as string), /must be a string/);
  });

  it('throws when value is null', () => {
    assert.throws(() => validateName(null as unknown as string), /must be a string/);
  });
});

// ─── validateAgentName ────────────────────────────────────────────────────────

describe('validateAgentName', () => {
  it('accepts names starting with letter', () => {
    assert.equal(validateAgentName('Aria'), 'Aria');
  });

  it('accepts names starting with digit', () => {
    assert.equal(validateAgentName('2fast'), '2fast');
  });

  it('accepts names with hyphens', () => {
    assert.equal(validateAgentName('my-agent-01'), 'my-agent-01');
  });

  it('accepts alphanumeric only', () => {
    assert.equal(validateAgentName('Agent01'), 'Agent01');
  });

  it('throws on empty string', () => {
    assert.throws(() => validateAgentName(''), /cannot be empty/);
  });

  it('throws when name exceeds max length', () => {
    assert.throws(
      () => validateAgentName('A'.repeat(MAX_AGENT_NAME_LENGTH + 1)),
      /must be ≤/,
    );
  });

  it('throws on name starting with hyphen', () => {
    assert.throws(() => validateAgentName('-myagent'), /must match/);
  });

  it('throws on name with underscore', () => {
    assert.throws(() => validateAgentName('my_agent'), /must match/);
  });

  it('throws when value is not a string', () => {
    assert.throws(() => validateAgentName(42 as unknown as string), /must be a string/);
  });
});

// ─── validateId ───────────────────────────────────────────────────────────────

describe('validateId', () => {
  it('accepts valid UUID v4', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    assert.equal(validateId(uuid), uuid);
  });

  it('accepts UUID with uppercase hex', () => {
    const uuid = '550E8400-E29B-41D4-A716-446655440000';
    assert.equal(validateId(uuid), uuid);
  });

  it('throws on invalid UUID format', () => {
    assert.throws(() => validateId('not-a-uuid'), /must be a valid UUID/);
  });

  it('throws on empty string', () => {
    assert.throws(() => validateId(''), /must be a valid UUID/);
  });

  it('throws on short UUID', () => {
    assert.throws(() => validateId('550e8400-e29b-41d4'), /must be a valid UUID/);
  });

  it('throws when value is not a string', () => {
    assert.throws(() => validateId(123 as unknown as string), /must be a string/);
  });
});

// ─── validateCwd ──────────────────────────────────────────────────────────────

describe('validateCwd', () => {
  it('accepts a valid path and resolves it', () => {
    const result = validateCwd('/tmp');
    assert.equal(result, '/tmp');
  });

  it('resolves relative paths to absolute', () => {
    const result = validateCwd('.');
    assert.ok(result.startsWith('/'));
  });

  it('throws on empty string', () => {
    assert.throws(() => validateCwd(''), /cannot be empty/);
  });

  it('throws on whitespace-only string', () => {
    assert.throws(() => validateCwd('   '), /cannot be empty/);
  });

  it('throws when path exceeds max length', () => {
    assert.throws(
      () => validateCwd('/' + 'a'.repeat(MAX_CWD_LENGTH + 1)),
      /exceeds maximum/,
    );
  });

  it('throws for /proc on Linux', () => {
    if (process.platform !== 'win32') {
      assert.throws(() => validateCwd('/proc'), /forbidden system path/);
    }
  });

  it('throws for /proc/1 on Linux', () => {
    if (process.platform !== 'win32') {
      assert.throws(() => validateCwd('/proc/1'), /forbidden system path/);
    }
  });

  it('throws for /sys on Linux', () => {
    if (process.platform !== 'win32') {
      assert.throws(() => validateCwd('/sys'), /forbidden system path/);
    }
  });

  it('throws for /dev on Linux', () => {
    if (process.platform !== 'win32') {
      assert.throws(() => validateCwd('/dev'), /forbidden system path/);
    }
  });

  it('throws for /run/user on Linux', () => {
    if (process.platform !== 'win32') {
      assert.throws(() => validateCwd('/run/user'), /forbidden system path/);
    }
  });

  it('throws when value is not a string', () => {
    assert.throws(() => validateCwd(42 as unknown as string), /must be a string/);
  });
});

// ─── validateRegex ────────────────────────────────────────────────────────────

describe('validateRegex', () => {
  it('accepts a valid simple regex', () => {
    assert.equal(validateRegex('hello.world'), 'hello.world');
  });

  it('accepts a valid regex with anchors', () => {
    assert.equal(validateRegex('^foo$'), '^foo$');
  });

  it('accepts a valid regex with character class', () => {
    assert.equal(validateRegex('[A-Z]+'), '[A-Z]+');
  });

  it('throws on nested quantifiers (++) — invalid regex or backtracking', () => {
    // a++ is invalid regex in some engines, which triggers the "not a valid regex" path
    assert.throws(() => validateRegex('a++'), /not a valid regex|catastrophic backtracking/);
  });

  it('throws on nested quantifiers (**) — invalid regex or backtracking', () => {
    // a** is invalid regex in some engines, which triggers the "not a valid regex" path
    assert.throws(() => validateRegex('a**'), /not a valid regex|catastrophic backtracking/);
  });

  it('throws on nested quantifiers ((a+)+)', () => {
    assert.throws(() => validateRegex('(a+)+'), /catastrophic backtracking/);
  });

  it('throws on quantified alternation (a|ab)*', () => {
    assert.throws(() => validateRegex('(a|ab)*'), /catastrophic backtracking/);
  });

  it('throws when regex exceeds max length', () => {
    assert.throws(
      () => validateRegex('a'.repeat(MAX_REGEX_LENGTH + 1)),
      /must be ≤/,
    );
  });

  it('throws on invalid regex syntax', () => {
    assert.throws(() => validateRegex('[unclosed'), /not a valid regex/);
  });

  it('throws when value is not a string', () => {
    assert.throws(() => validateRegex(42 as unknown as string), /must be a string/);
  });
});

// ─── validatePermissionMode ───────────────────────────────────────────────────

describe('validatePermissionMode', () => {
  it('accepts bypassPermissions', () => {
    assert.equal(validatePermissionMode('bypassPermissions'), 'bypassPermissions');
  });

  it('accepts acceptEdits', () => {
    assert.equal(validatePermissionMode('acceptEdits'), 'acceptEdits');
  });

  it('accepts auto', () => {
    assert.equal(validatePermissionMode('auto'), 'auto');
  });

  it('accepts plan', () => {
    assert.equal(validatePermissionMode('plan'), 'plan');
  });

  it('throws on invalid mode', () => {
    assert.throws(() => validatePermissionMode('superMode'), /must be one of/);
  });

  it('throws when value is not a string', () => {
    assert.throws(() => validatePermissionMode(42 as unknown as string), /must be a string/);
  });
});

// ─── validateEffort ───────────────────────────────────────────────────────────

describe('validateEffort', () => {
  const validLevels = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'];

  for (const level of validLevels) {
    it(`accepts ${level}`, () => {
      assert.equal(validateEffort(level), level);
    });
  }

  it('throws on invalid effort level', () => {
    assert.throws(() => validateEffort('ultra'), /must be one of/);
  });

  it('throws when value is not a string', () => {
    assert.throws(() => validateEffort(42 as unknown as string), /must be a string/);
  });
});

// ─── validateTimeout ──────────────────────────────────────────────────────────

describe('validateTimeout', () => {
  it('accepts value within range', () => {
    assert.equal(validateTimeout(5_000), 5_000);
  });

  it('accepts MIN_TIMEOUT_MS exactly', () => {
    assert.equal(validateTimeout(MIN_TIMEOUT_MS), MIN_TIMEOUT_MS);
  });

  it('accepts MAX_TIMEOUT_MS exactly', () => {
    assert.equal(validateTimeout(MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
  });

  it('throws when below MIN_TIMEOUT_MS', () => {
    assert.throws(() => validateTimeout(MIN_TIMEOUT_MS - 1), /must be ≥/);
  });

  it('throws when above MAX_TIMEOUT_MS', () => {
    assert.throws(() => validateTimeout(MAX_TIMEOUT_MS + 1), /must be ≤/);
  });

  it('throws for NaN', () => {
    assert.throws(() => validateTimeout(NaN), /must be a finite number/);
  });

  it('throws for Infinity', () => {
    assert.throws(() => validateTimeout(Infinity), /must be a finite number/);
  });

  it('throws when value is not a number', () => {
    assert.throws(() => validateTimeout('5000' as unknown as number), /must be a finite number/);
  });
});

// ─── validatePositiveInt ──────────────────────────────────────────────────────

describe('validatePositiveInt', () => {
  it('accepts positive integers', () => {
    assert.equal(validatePositiveInt(1, 'count'), 1);
    assert.equal(validatePositiveInt(100, 'count'), 100);
  });

  it('throws for 0', () => {
    assert.throws(() => validatePositiveInt(0, 'count'), /must be a positive integer/);
  });

  it('throws for negative integers', () => {
    assert.throws(() => validatePositiveInt(-1, 'count'), /must be a positive integer/);
  });

  it('throws for floats', () => {
    assert.throws(() => validatePositiveInt(1.5, 'count'), /must be a positive integer/);
  });

  it('throws when exceeding max', () => {
    assert.throws(() => validatePositiveInt(11, 'count', 10), /must be ≤/);
  });

  it('accepts value equal to max', () => {
    assert.equal(validatePositiveInt(10, 'count', 10), 10);
  });

  it('throws when value is not a number', () => {
    assert.throws(() => validatePositiveInt('5' as unknown as number, 'count'), /must be a positive integer/);
  });
});

// ─── validateStringField ─────────────────────────────────────────────────────

describe('validateStringField', () => {
  it('accepts a valid string', () => {
    assert.equal(validateStringField('hello world', 'message'), 'hello world');
  });

  it('accepts a multiline string', () => {
    const val = 'line1\nline2\nline3';
    assert.equal(validateStringField(val, 'text'), val);
  });

  it('throws on empty string', () => {
    assert.throws(() => validateStringField('', 'message'), /cannot be empty/);
  });

  it('throws on whitespace-only string', () => {
    assert.throws(() => validateStringField('   ', 'message'), /cannot be empty/);
  });

  it('throws when exceeding max length', () => {
    assert.throws(
      () => validateStringField('a'.repeat(MAX_STRING_FIELD_LENGTH + 1), 'text'),
      /must be ≤/,
    );
  });

  it('throws on custom max length', () => {
    assert.throws(
      () => validateStringField('hello world', 'text', 5),
      /must be ≤/,
    );
  });

  it('throws when value is not a string', () => {
    assert.throws(() => validateStringField(42 as unknown as string, 'value'), /must be a string/);
  });
});

// ─── validateToolName ────────────────────────────────────────────────────────

describe('validateToolName', () => {
  it('accepts Bash', () => {
    assert.equal(validateToolName('Bash'), 'Bash');
  });

  it('accepts mcp__server__tool', () => {
    assert.equal(validateToolName('mcp__server__tool'), 'mcp__server__tool');
  });

  it('accepts wildcard *', () => {
    assert.equal(validateToolName('*'), '*');
  });

  it('accepts bash:run', () => {
    assert.equal(validateToolName('bash:run'), 'bash:run');
  });

  it('accepts Read', () => {
    assert.equal(validateToolName('Read'), 'Read');
  });

  it('throws on empty string', () => {
    assert.throws(() => validateToolName(''), /cannot be empty/);
  });

  it('throws on name with spaces', () => {
    assert.throws(() => validateToolName('my tool'), /invalid characters/);
  });

  it('throws on name with $ character', () => {
    assert.throws(() => validateToolName('Bash$'), /invalid characters/);
  });

  it('throws on name starting with digit', () => {
    assert.throws(() => validateToolName('1tool'), /invalid characters/);
  });

  it('throws when value is not a string', () => {
    assert.throws(() => validateToolName(42 as unknown as string), /must be a string/);
  });
});

// ─── validateModel ────────────────────────────────────────────────────────────

describe('validateModel', () => {
  it('accepts claude-opus-4-7', () => {
    assert.equal(validateModel('claude-opus-4-7'), 'claude-opus-4-7');
  });

  it('accepts claude-sonnet-4-6', () => {
    assert.equal(validateModel('claude-sonnet-4-6'), 'claude-sonnet-4-6');
  });

  it('accepts short alias opus', () => {
    assert.equal(validateModel('opus'), 'opus');
  });

  it('accepts short alias sonnet', () => {
    assert.equal(validateModel('sonnet'), 'sonnet');
  });

  it('accepts short alias haiku', () => {
    assert.equal(validateModel('haiku'), 'haiku');
  });

  it('accepts versioned model with dots', () => {
    assert.equal(validateModel('claude-3.5-sonnet'), 'claude-3.5-sonnet');
  });

  it('throws on empty string', () => {
    assert.throws(() => validateModel(''), /cannot be empty/);
  });

  it('throws on model with spaces', () => {
    assert.throws(() => validateModel('claude opus'), /invalid characters/);
  });

  it('throws on model with $ character', () => {
    assert.throws(() => validateModel('claude$opus'), /invalid characters/);
  });

  it('throws on model with shell metacharacters', () => {
    assert.throws(() => validateModel('claude;rm'), /invalid characters/);
  });

  it('throws when value is not a string', () => {
    assert.throws(() => validateModel(42 as unknown as string), /must be a string/);
  });
});
