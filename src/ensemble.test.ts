import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseConsensus, buildRoundPrompt } from './ensemble.js';
import type { AgentPersona } from './types.js';

// ─── parseConsensus ───────────────────────────────────────────────────────────

describe('parseConsensus', () => {
  it('returns true for [CONSENSUS: YES]', () => {
    assert.equal(parseConsensus('[CONSENSUS: YES]'), true);
  });

  it('returns false for [CONSENSUS: NO]', () => {
    assert.equal(parseConsensus('[CONSENSUS: NO]'), false);
  });

  it('is case-insensitive for [consensus: yes]', () => {
    assert.equal(parseConsensus('[consensus: yes]'), true);
  });

  it('is case-insensitive for [CONSENSUS: no]', () => {
    assert.equal(parseConsensus('[CONSENSUS: no]'), false);
  });

  it('matches anywhere in the text', () => {
    assert.equal(
      parseConsensus('some text [CONSENSUS: YES] more text at the end'),
      true,
    );
  });

  it('matches NO anywhere in the text', () => {
    assert.equal(
      parseConsensus('prefix content [CONSENSUS: NO] suffix content'),
      false,
    );
  });

  it('returns null when no tag is found', () => {
    assert.equal(parseConsensus('no tag here at all'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseConsensus(''), null);
  });

  it('returns null for partial tag', () => {
    assert.equal(parseConsensus('[CONSENSUS:'), null);
  });

  it('handles extra spaces inside tag', () => {
    // The regex uses \s* so handles optional spaces
    assert.equal(parseConsensus('[CONSENSUS:  YES]'), true);
  });
});

// ─── buildRoundPrompt ─────────────────────────────────────────────────────────

const testAgent: AgentPersona = {
  name: 'Aria',
  emoji: '🎯',
  persona: 'Senior full-stack engineer',
};

describe('buildRoundPrompt round 1', () => {
  it('contains "Round 1" header', () => {
    const prompt = buildRoundPrompt(1, 'Add auth', null, '', [], testAgent, 'ensemble/Aria');
    assert.ok(prompt.includes('Round 1'));
  });

  it('contains the task text', () => {
    const prompt = buildRoundPrompt(1, 'Add auth', null, '', [], testAgent, 'ensemble/Aria');
    assert.ok(prompt.includes('Add auth'));
  });

  it('contains plan.md reference', () => {
    const prompt = buildRoundPrompt(1, 'My task', null, '', [], testAgent, 'ensemble/Aria');
    assert.ok(prompt.includes('plan.md'));
  });

  it('contains "Do NOT write any business code"', () => {
    const prompt = buildRoundPrompt(1, 'My task', null, '', [], testAgent, 'ensemble/Aria');
    assert.ok(prompt.includes('Do NOT write any business code'));
  });

  it('includes the branch name', () => {
    const prompt = buildRoundPrompt(1, 'My task', null, '', [], testAgent, 'ensemble/Aria');
    assert.ok(prompt.includes('ensemble/Aria'));
  });
});

describe('buildRoundPrompt round 2 with plan', () => {
  const plan = '# Plan\n- [ ] Task A\n- [ ] Task B';
  const gitLog = 'abc1234 init commit\ndef5678 add plan.md';

  it('includes plan content', () => {
    const prompt = buildRoundPrompt(2, 'My task', plan, gitLog, [], testAgent, 'ensemble/Aria');
    assert.ok(prompt.includes('Task A'));
    assert.ok(prompt.includes('Task B'));
  });

  it('includes round instructions', () => {
    const prompt = buildRoundPrompt(2, 'My task', plan, gitLog, [], testAgent, 'ensemble/Aria');
    assert.ok(prompt.includes('Round Instructions'));
  });

  it('includes git log', () => {
    const prompt = buildRoundPrompt(2, 'My task', plan, gitLog, [], testAgent, 'ensemble/Aria');
    assert.ok(prompt.includes('abc1234 init commit'));
  });

  it('includes git pull instruction', () => {
    const prompt = buildRoundPrompt(2, 'My task', plan, gitLog, [], testAgent, 'ensemble/Aria');
    assert.ok(prompt.includes('git pull'));
  });

  it('does not include "Do NOT write any business code" in round 2', () => {
    const prompt = buildRoundPrompt(2, 'My task', plan, gitLog, [], testAgent, 'ensemble/Aria');
    assert.ok(!prompt.includes('Do NOT write any business code'));
  });
});

describe('buildRoundPrompt with injected messages', () => {
  it('includes Director\'s Cue section', () => {
    const prompt = buildRoundPrompt(
      2, 'My task', null, '', ['Focus on security', 'Check tests'],
      testAgent, 'ensemble/Aria',
    );
    assert.ok(prompt.includes("Director's Cue"));
  });

  it('includes each injected message', () => {
    const prompt = buildRoundPrompt(
      2, 'My task', null, '', ['Focus on security', 'Check tests'],
      testAgent, 'ensemble/Aria',
    );
    assert.ok(prompt.includes('Focus on security'));
    assert.ok(prompt.includes('Check tests'));
  });

  it('does not include Director\'s Cue section when no injected messages', () => {
    const prompt = buildRoundPrompt(1, 'My task', null, '', [], testAgent, 'ensemble/Aria');
    assert.ok(!prompt.includes("Director's Cue"));
  });
});

describe('buildRoundPrompt consensus instructions', () => {
  it('always ends with [CONSENSUS: YES] or [CONSENSUS: NO] instruction', () => {
    const prompt1 = buildRoundPrompt(1, 'task', null, '', [], testAgent, 'ensemble/Aria');
    assert.ok(
      prompt1.includes('[CONSENSUS: YES]') && prompt1.includes('[CONSENSUS: NO]'),
    );
  });

  it('includes consensus instruction in round 2 as well', () => {
    const prompt2 = buildRoundPrompt(2, 'task', null, '', [], testAgent, 'ensemble/Aria');
    assert.ok(
      prompt2.includes('[CONSENSUS: YES]') && prompt2.includes('[CONSENSUS: NO]'),
    );
  });

  it('prompt ends with consensus instruction line', () => {
    const prompt = buildRoundPrompt(1, 'task', null, '', [], testAgent, 'ensemble/Aria');
    const lines = prompt.split('\n').filter((l) => l.trim() !== '');
    const lastLine = lines[lines.length - 1];
    assert.ok(lastLine.includes('[CONSENSUS: YES]') || lastLine.includes('[CONSENSUS: NO]'));
  });
});
