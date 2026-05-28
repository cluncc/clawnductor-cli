import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, optStr, optBool, optInt } from './args.js';

// ─── parseArgs ────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('returns empty pos and opt for empty array', () => {
    const { pos, opt } = parseArgs([]);
    assert.deepEqual(pos, []);
    assert.deepEqual(opt, {});
  });

  it('parses --key value into opt.key', () => {
    const { pos, opt } = parseArgs(['--key', 'value']);
    assert.equal(opt['key'], 'value');
    assert.deepEqual(pos, []);
  });

  it('parses --flag alone as true', () => {
    const { pos, opt } = parseArgs(['--flag']);
    assert.equal(opt['flag'], true);
    assert.deepEqual(pos, []);
  });

  it('parses -k value into opt.k', () => {
    const { pos, opt } = parseArgs(['-k', 'value']);
    assert.equal(opt['k'], 'value');
    assert.deepEqual(pos, []);
  });

  it('parses -k alone as true', () => {
    const { pos, opt } = parseArgs(['-k']);
    assert.equal(opt['k'], true);
  });

  it('treats -- as separator — rest are positional', () => {
    const { pos, opt } = parseArgs(['--flag', '--', '--not-an-opt', 'val']);
    assert.equal(opt['flag'], true);
    assert.deepEqual(pos, ['--not-an-opt', 'val']);
    assert.equal(opt['not-an-opt'], undefined);
  });

  it('treats bare strings as positional', () => {
    const { pos } = parseArgs(['foo', 'bar', 'baz']);
    assert.deepEqual(pos, ['foo', 'bar', 'baz']);
  });

  it('parses mixed positionals and options', () => {
    const { pos, opt } = parseArgs(['cmd', '--model', 'opus', 'sub', '--flag']);
    assert.deepEqual(pos, ['cmd', 'sub']);
    assert.equal(opt['model'], 'opus');
    assert.equal(opt['flag'], true);
  });

  it('treats next token starting with - as not a value', () => {
    const { opt } = parseArgs(['--key', '--other', 'val']);
    assert.equal(opt['key'], true);
    assert.equal(opt['other'], 'val');
  });

  it('stops consuming value when next token is -k short flag', () => {
    const { opt } = parseArgs(['--flag', '-k']);
    assert.equal(opt['flag'], true);
    assert.equal(opt['k'], true);
  });
});

// ─── optStr ───────────────────────────────────────────────────────────────────

describe('optStr', () => {
  it('returns string value when key exists as string', () => {
    const opt = { key: 'hello' };
    assert.equal(optStr(opt, 'key'), 'hello');
  });

  it('returns undefined when value is boolean true', () => {
    const opt: Record<string, string | boolean> = { flag: true };
    assert.equal(optStr(opt, 'flag'), undefined);
  });

  it('returns undefined when key is missing', () => {
    const opt: Record<string, string | boolean> = {};
    assert.equal(optStr(opt, 'missing'), undefined);
  });

  it('returns empty string when value is empty string', () => {
    const opt = { key: '' };
    assert.equal(optStr(opt, 'key'), '');
  });
});

// ─── optBool ─────────────────────────────────────────────────────────────────

describe('optBool', () => {
  it('returns true when value is boolean true', () => {
    const opt: Record<string, string | boolean> = { flag: true };
    assert.equal(optBool(opt, 'flag'), true);
  });

  it('returns true when value is string "true"', () => {
    const opt: Record<string, string | boolean> = { flag: 'true' };
    assert.equal(optBool(opt, 'flag'), true);
  });

  it('returns false when key is missing', () => {
    const opt: Record<string, string | boolean> = {};
    assert.equal(optBool(opt, 'missing'), false);
  });

  it('returns false when value is a non-"true" string', () => {
    const opt: Record<string, string | boolean> = { flag: 'yes' };
    assert.equal(optBool(opt, 'flag'), false);
  });

  it('returns false when value is false boolean', () => {
    const opt: Record<string, string | boolean> = { flag: false };
    assert.equal(optBool(opt, 'flag'), false);
  });
});

// ─── optInt ───────────────────────────────────────────────────────────────────

describe('optInt', () => {
  it('parses a valid integer string', () => {
    const opt: Record<string, string | boolean> = { count: '42' };
    assert.equal(optInt(opt, 'count'), 42);
  });

  it('parses negative integers', () => {
    const opt: Record<string, string | boolean> = { count: '-5' };
    assert.equal(optInt(opt, 'count'), -5);
  });

  it('returns defaultVal when key is missing', () => {
    const opt: Record<string, string | boolean> = {};
    assert.equal(optInt(opt, 'count', 99), 99);
  });

  it('returns undefined when key is missing and no defaultVal', () => {
    const opt: Record<string, string | boolean> = {};
    assert.equal(optInt(opt, 'count'), undefined);
  });

  it('throws for non-integer string', () => {
    const opt: Record<string, string | boolean> = { count: 'abc' };
    assert.throws(() => optInt(opt, 'count'), /must be an integer/);
  });

  it('throws for float string', () => {
    const opt: Record<string, string | boolean> = { count: '3.14' };
    assert.throws(() => optInt(opt, 'count'), /must be an integer/);
  });

  it('returns undefined when value is boolean true (not a string)', () => {
    const opt: Record<string, string | boolean> = { count: true };
    // optStr returns undefined for boolean, so optInt returns defaultVal
    assert.equal(optInt(opt, 'count'), undefined);
  });
});
