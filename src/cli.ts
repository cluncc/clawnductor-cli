#!/usr/bin/env node
/**
 * clawnductor CLI
 *
 * Cross-platform CLI version of the clawnductor OpenClaw plugin.
 * Provides persistent Claude Code sessions (jam), multi-agent ensembles,
 * deep planning (overture), and fleet code review (finale).
 *
 * Zero external dependencies. Requires Node.js >=22 and claude CLI in PATH.
 *
 * Usage:
 *   clawnductor <command> [subcommand] [args...] [options]
 *
 * State is stored in ~/.clawnductor/
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PersistentClaudeSession } from './session.js';
import { Ensemble } from './ensemble.js';
import * as state from './state.js';
import {
  validateName,
  validateCwd,
  validateRegex,
  validatePermissionMode,
  validateEffort,
  validateModel,
  validateToolName,
  validateStringField,
} from './validation.js';
import { parseArgs, optStr, optBool, optInt } from './args.js';
import {
  type PermissionMode,
  type EffortLevel,
  type StoredSession,
  type EnsembleSession,
  type EnsembleConfig,
  type AgentPersona,
  resolveModelAlias,
  DEFAULT_AGENT_POOL,
  REVIEWER_FLEET,
  DEFAULT_MAX_ROUNDS,
  DEFAULT_AGENT_TIMEOUT_MS,
  DEFAULT_MAX_TURNS_PER_AGENT,
  TURN_TIMEOUT_MS,
  ULTRAPLAN_SYSTEM_PROMPT,
  ULTRAPLAN_TIMEOUT_MS,
  MAX_STORED_MESSAGES,
} from './types.js';

const VERSION = '1.0.0';

// ─── Terminal output helpers ──────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const isErrTTY = process.stderr.isTTY;

function clr(code: string, text: string): string {
  return isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}
function clrErr(code: string, text: string): string {
  return isErrTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}

const bold = (t: string) => clr('1', t);
const dim = (t: string) => clr('2', t);
const green = (t: string) => clr('32', t);
const red = (t: string) => clr('31', t);
const yellow = (t: string) => clr('33', t);
const cyan = (t: string) => clr('36', t);

function log(msg: string): void { process.stderr.write(clrErr('2', msg) + '\n'); }
function info(msg: string): void { process.stderr.write(msg + '\n'); }
function die(msg: string): never {
  process.stderr.write(clrErr('31', `Error: ${msg}`) + '\n');
  process.exit(1);
}

function fmtDate(ts: string | number | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function fmtCost(usd: number): string {
  return usd > 0 ? `$${usd.toFixed(4)}` : '$0.00';
}

function printJson(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

// ─── Argument parsing ─────────────────────────────────────────────────────────

function claudeBin(opt: Record<string, string | boolean>): string {
  return optStr(opt, 'claude-bin') ?? process.env.CLAUDE_BIN ?? 'claude';
}

// ─── Jam commands ─────────────────────────────────────────────────────────────

async function cmdJamStart(argv: string[]): Promise<void> {
  const { pos, opt } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor jam start <name> [options]');

  const name = validateName(pos[0], 'name');
  const cwd = validateCwd(optStr(opt, 'cwd') ?? process.cwd(), 'cwd');
  const model = optStr(opt, 'model');
  const permissionMode = optStr(opt, 'permission-mode')
    ? (validatePermissionMode(optStr(opt, 'permission-mode')) as PermissionMode)
    : 'bypassPermissions';
  const effort = optStr(opt, 'effort')
    ? (validateEffort(optStr(opt, 'effort')) as EffortLevel)
    : undefined;
  const maxTurns = optInt(opt, 'max-turns');
  const appendSystemPrompt = optStr(opt, 'system-prompt');
  const allowedTools = optStr(opt, 'allow')?.split(',').map((t) => validateToolName(t.trim())).filter(Boolean);
  const disallowedTools = optStr(opt, 'disallow')?.split(',').map((t) => validateToolName(t.trim())).filter(Boolean);
  const mcpConfig = optStr(opt, 'mcp')?.split(',').map((t) => t.trim()).filter(Boolean);
  const bin = claudeBin(opt);

  if (state.sessionExists(name)) {
    info(yellow(`Warning: session "${name}" already exists — overwriting config`));
  }

  const session: StoredSession = {
    name,
    config: {
      cwd,
      claudeBin: bin !== 'claude' ? bin : undefined,
      model,
      permissionMode,
      effort,
      maxTurns,
      appendSystemPrompt,
      allowedTools,
      disallowedTools,
      mcpConfig,
    },
    created: new Date().toISOString(),
    stats: { turns: 0, tokensIn: 0, tokensOut: 0, cachedTokens: 0, costUsd: 0 },
    history: [],
  };

  state.saveSession(session);
  console.log(green(`Session "${name}" created`) + `  cwd: ${cwd}  model: ${model ?? 'default'}`);
}

async function cmdJamPlay(argv: string[]): Promise<void> {
  const { pos, opt } = parseArgs(argv);
  if (pos.length < 2) die('Usage: clawnductor jam play <name> <message...>');

  const name = validateName(pos[0], 'name');
  const message = pos.slice(1).join(' ');
  const timeout = optInt(opt, 'timeout') ?? TURN_TIMEOUT_MS;
  const planMode = optBool(opt, 'plan');
  const stored = state.getSession(name);
  const bin = claudeBin(opt) !== 'claude' ? claudeBin(opt) : (stored.config.claudeBin ?? 'claude');

  const finalMessage = planMode ? `/plan ${message}` : message;

  const session = new PersistentClaudeSession(
    {
      name,
      cwd: stored.config.cwd,
      model: stored.config.model,
      permissionMode: stored.config.permissionMode,
      effort: stored.config.effort,
      allowedTools: stored.config.allowedTools,
      disallowedTools: stored.config.disallowedTools,
      maxTurns: stored.config.maxTurns,
      appendSystemPrompt: stored.config.appendSystemPrompt,
      mcpConfig: stored.config.mcpConfig,
      resumeSessionId: stored.claudeSessionId,
    },
    bin,
  );

  session.on('stderr', (text: string) => { if (text.trim()) log(text); });
  session.on('chunk', (text: string) => process.stdout.write(text));

  await session.start();

  const result = await session.send(finalMessage, { timeout });
  session.stop();

  // Ensure output ends with newline
  if (result.output && !result.output.endsWith('\n')) process.stdout.write('\n');

  // Update persisted state
  const stats = session.getStats();
  stored.claudeSessionId = result.sessionId ?? stored.claudeSessionId;
  stored.lastActivity = Date.now();
  stored.stats = {
    turns: (stored.stats?.turns ?? 0) + stats.turns,
    tokensIn: (stored.stats?.tokensIn ?? 0) + stats.tokensIn,
    tokensOut: (stored.stats?.tokensOut ?? 0) + stats.tokensOut,
    cachedTokens: (stored.stats?.cachedTokens ?? 0) + stats.cachedTokens,
    costUsd: (stored.stats?.costUsd ?? 0) + stats.costUsd,
  };

  // Append to history (last N messages)
  const history = stored.history ?? [];
  history.push({ role: 'user', content: message, timestamp: new Date().toISOString() });
  history.push({ role: 'assistant', content: result.output, timestamp: new Date().toISOString() });
  stored.history = history.slice(-MAX_STORED_MESSAGES);

  state.saveSession(stored);
}

async function cmdJamEnd(argv: string[]): Promise<void> {
  const { pos } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor jam end <name>');

  const name = validateName(pos[0], 'name');
  if (!state.deleteSession(name)) {
    die(`Session "${name}" not found`);
  }
  console.log(green(`Session "${name}" ended`));
}

function cmdJamList(argv: string[]): void {
  const { opt } = parseArgs(argv);
  const sessions = Object.values(state.getSessions());

  if (optBool(opt, 'json')) {
    printJson(sessions);
    return;
  }

  if (sessions.length === 0) {
    console.log('No sessions. Create one with: clawnductor jam start <name>');
    return;
  }

  console.log(bold(`\n  ${'NAME'.padEnd(20)} ${'MODEL'.padEnd(15)} ${'CWD'.padEnd(40)} LAST ACTIVE`));
  console.log('  ' + '─'.repeat(90));

  for (const s of sessions) {
    const model = s.config.model ? resolveModelAlias(s.config.model).split('-').slice(-2).join('-') : 'default';
    const cwd = s.config.cwd.length > 38 ? '…' + s.config.cwd.slice(-37) : s.config.cwd;
    const last = s.lastActivity ? fmtDate(s.lastActivity) : dim('never');
    console.log(`  ${cyan(s.name.padEnd(20))} ${model.padEnd(15)} ${dim(cwd.padEnd(40))} ${last}`);
  }
  console.log();
}

function cmdJamStatus(argv: string[]): void {
  const { pos, opt } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor jam status <name>');

  const name = validateName(pos[0], 'name');
  const stored = state.getSession(name);

  if (optBool(opt, 'json')) {
    printJson(stored);
    return;
  }

  const cfg = stored.config;
  const st = stored.stats;
  console.log(`\n${bold(cyan(stored.name))}`);
  console.log(`  Created:     ${fmtDate(stored.created)}`);
  console.log(`  Last active: ${stored.lastActivity ? fmtDate(stored.lastActivity) : dim('never')}`);
  console.log(`  Session ID:  ${stored.claudeSessionId ? dim(stored.claudeSessionId) : dim('none (first play pending)')}`);
  console.log(`  CWD:         ${cfg.cwd}`);
  console.log(`  Model:       ${cfg.model ? resolveModelAlias(cfg.model) : 'default'}`);
  console.log(`  Permission:  ${cfg.permissionMode ?? 'bypassPermissions'}`);
  if (cfg.effort) console.log(`  Effort:      ${cfg.effort}`);
  if (cfg.allowedTools?.length) console.log(`  Allow:       ${cfg.allowedTools.join(', ')}`);
  if (cfg.disallowedTools?.length) console.log(`  Disallow:    ${cfg.disallowedTools.join(', ')}`);
  if (st) {
    console.log(`\n  ${bold('Stats')}`);
    console.log(`  Turns:       ${st.turns}`);
    console.log(`  Tokens in:   ${st.tokensIn.toLocaleString()}`);
    console.log(`  Tokens out:  ${st.tokensOut.toLocaleString()}`);
    console.log(`  Cached:      ${st.cachedTokens.toLocaleString()}`);
    console.log(`  Cost:        ${fmtCost(st.costUsd)}`);
  }
  console.log();
}

function cmdJamGroove(argv: string[]): void {
  const { pos, opt } = parseArgs(argv);
  if (pos.length < 2) die('Usage: clawnductor jam groove <name> <pattern> [--limit <n>]');

  const name = validateName(pos[0], 'name');
  const pattern = validateRegex(pos[1], 'pattern');
  const limit = optInt(opt, 'limit') ?? 20;
  const stored = state.getSession(name);

  if (!stored.history?.length) {
    console.log(dim('No message history. Use jam play to start a conversation.'));
    return;
  }

  const re = new RegExp(pattern, 'i');
  const matches = stored.history.filter((m) => re.test(m.content)).slice(-limit);

  if (matches.length === 0) {
    console.log(dim(`No matches for pattern: ${pattern}`));
    return;
  }

  for (const m of matches) {
    const role = m.role === 'user' ? cyan('user') : green('assistant');
    console.log(`\n[${fmtDate(m.timestamp)}] ${role}`);
    console.log(m.content.slice(0, 500) + (m.content.length > 500 ? dim('…') : ''));
  }
}

async function cmdJamBridge(argv: string[]): Promise<void> {
  const { pos, opt } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor jam bridge <name> [summary]');

  const name = validateName(pos[0], 'name');
  const summary = pos.slice(1).join(' ') || undefined;
  const stored = state.getSession(name);
  const bin = stored.config.claudeBin ?? 'claude';

  if (!stored.claudeSessionId) {
    die(`Session "${name}" has no session ID — run jam play first`);
  }

  info(dim(`Compacting session "${name}"...`));

  const session = new PersistentClaudeSession(
    {
      name,
      cwd: stored.config.cwd,
      model: stored.config.model,
      permissionMode: stored.config.permissionMode,
      resumeSessionId: stored.claudeSessionId,
    },
    bin,
  );

  session.on('stderr', (text: string) => { if (text.trim()) log(text); });

  await session.start();
  const result = await session.compact(summary);
  session.stop();

  stored.claudeSessionId = result.sessionId ?? stored.claudeSessionId;
  stored.lastActivity = Date.now();
  state.saveSession(stored);

  if (optBool(opt, 'json')) {
    printJson({ name, sessionId: stored.claudeSessionId, output: result.output });
  } else {
    console.log(green('Context compacted.'));
    if (result.output) console.log(dim(result.output.slice(0, 200)));
  }
}

function cmdJamTranspose(argv: string[]): void {
  const { pos } = parseArgs(argv);
  if (pos.length < 2) die('Usage: clawnductor jam transpose <name> <model>');

  const name = validateName(pos[0], 'name');
  const model = validateModel(pos[1], 'model');
  const stored = state.getSession(name);

  stored.config.model = model;
  state.saveSession(stored);

  const resolved = resolveModelAlias(model);
  console.log(green(`Session "${name}" model set to ${resolved}`));
}

function cmdJamRekey(argv: string[]): void {
  const { pos, opt } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor jam rekey <name> [--allow <tools>] [--disallow <tools>] [--remove <tools>] [--merge]');

  const name = validateName(pos[0], 'name');
  const stored = state.getSession(name);
  const merge = optBool(opt, 'merge');

  const allow = optStr(opt, 'allow')?.split(',').map((t) => validateToolName(t.trim())).filter(Boolean);
  const disallow = optStr(opt, 'disallow')?.split(',').map((t) => validateToolName(t.trim())).filter(Boolean);
  const remove = optStr(opt, 'remove')?.split(',').map((t) => t.trim()).filter(Boolean);

  let allowed = merge ? [...(stored.config.allowedTools ?? [])] : (allow ?? stored.config.allowedTools ?? []);
  let disallowed = merge ? [...(stored.config.disallowedTools ?? [])] : (disallow ?? stored.config.disallowedTools ?? []);

  if (merge) {
    if (allow) allowed = [...new Set([...allowed, ...allow])];
    if (disallow) disallowed = [...new Set([...disallowed, ...disallow])];
  }

  if (remove?.length) {
    const rm = new Set(remove);
    allowed = allowed.filter((t) => !rm.has(t));
    disallowed = disallowed.filter((t) => !rm.has(t));
  }

  stored.config.allowedTools = allowed.length ? allowed : undefined;
  stored.config.disallowedTools = disallowed.length ? disallowed : undefined;
  state.saveSession(stored);

  console.log(green(`Session "${name}" tools updated`));
  if (allowed.length) console.log(`  Allow:    ${allowed.join(', ')}`);
  if (disallowed.length) console.log(`  Disallow: ${disallowed.join(', ')}`);
}

function cmdJamRoster(argv: string[]): void {
  const { opt } = parseArgs(argv);
  const cwd = validateCwd(optStr(opt, 'cwd') ?? process.cwd(), 'cwd');
  const dir = path.join(cwd, '.claude', 'agents');

  if (!fs.existsSync(dir)) {
    console.log(dim(`No agents directory found at ${dir}`));
    return;
  }

  const agents = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const file = path.join(dir, f);
      const content = fs.readFileSync(file, 'utf8');
      const desc = content.match(/^description:\s*(.+)$/m)?.[1] ?? '';
      return { name: f.replace(/\.md$/, ''), description: desc, file };
    });

  if (agents.length === 0) {
    console.log(dim('No agent definitions found.'));
    return;
  }

  console.log(bold(`\n  ${'NAME'.padEnd(25)} DESCRIPTION`));
  console.log('  ' + '─'.repeat(70));
  for (const a of agents) {
    console.log(`  ${cyan(a.name.padEnd(25))} ${a.description}`);
  }
  console.log();
}

// ─── Bandstand ────────────────────────────────────────────────────────────────

function cmdBandstand(argv: string[]): void {
  const { opt } = parseArgs(argv);
  const sessions = Object.values(state.getSessions());
  const ensembles = Object.values(state.getEnsembles());
  const plans = Object.values(state.getUltraplans());
  const reviews = Object.values(state.getUltrareviews());

  if (optBool(opt, 'json')) {
    printJson({ sessions, ensembles, ultraplans: plans, ultrareviews: reviews });
    return;
  }

  console.log(bold('\n  Clawnductor — Session Health Dashboard\n'));
  console.log(`  Sessions:    ${sessions.length}`);
  console.log(`  Ensembles:   ${ensembles.length}`);
  console.log(`  Ultraplans:  ${plans.length}`);
  console.log(`  Ultrareviews:${reviews.length}`);

  if (sessions.length) {
    console.log(bold(`\n  ${'SESSION'.padEnd(20)} ${'MODEL'.padEnd(20)} ${'TURNS'.padEnd(8)} ${'COST'.padEnd(10)} LAST ACTIVE`));
    console.log('  ' + '─'.repeat(80));
    for (const s of sessions) {
      const model = s.config.model ? resolveModelAlias(s.config.model).split('-').slice(-2).join('-') : 'default';
      const turns = String(s.stats?.turns ?? 0);
      const cost = fmtCost(s.stats?.costUsd ?? 0);
      const last = s.lastActivity ? fmtDate(s.lastActivity) : dim('never');
      console.log(`  ${cyan(s.name.padEnd(20))} ${model.padEnd(20)} ${turns.padEnd(8)} ${cost.padEnd(10)} ${last}`);
    }
  }

  if (ensembles.length) {
    console.log(bold(`\n  ${'ENSEMBLE ID'.padEnd(38)} ${'STATUS'.padEnd(14)} ROUND`));
    console.log('  ' + '─'.repeat(60));
    for (const e of ensembles.slice(-10)) {
      const statusClr = e.status === 'consensus' ? green(e.status)
        : e.status === 'error' ? red(e.status)
        : yellow(e.status);
      console.log(`  ${dim(e.id.padEnd(38))} ${statusClr.padEnd(20)} ${e.round}`);
    }
  }

  console.log();
}

// ─── Ensemble commands ────────────────────────────────────────────────────────

async function cmdEnsembleStart(argv: string[]): Promise<void> {
  const { pos, opt } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor ensemble start <task...> --cwd <path> [options]');

  const task = validateStringField(pos.join(' '), 'task');
  const cwd = validateCwd(optStr(opt, 'cwd') ?? process.cwd(), 'cwd');
  const agentCount = Math.min(8, Math.max(1, optInt(opt, 'agents') ?? 3));
  const maxRounds = optInt(opt, 'max-rounds') ?? DEFAULT_MAX_ROUNDS;
  const model = optStr(opt, 'model');
  const timeout = optInt(opt, 'timeout') ?? DEFAULT_AGENT_TIMEOUT_MS;
  const permMode = optStr(opt, 'permission-mode')
    ? (validatePermissionMode(optStr(opt, 'permission-mode')) as PermissionMode)
    : 'bypassPermissions';
  const bin = claudeBin(opt);

  const agents: AgentPersona[] = DEFAULT_AGENT_POOL.slice(0, agentCount).map((a) => ({
    name: a.name,
    emoji: a.emoji,
    persona: a.persona,
    model,
    permissionMode: permMode,
  }));

  const config: EnsembleConfig = {
    agents,
    maxRounds,
    projectDir: cwd,
    agentTimeoutMs: timeout,
    maxTurnsPerAgent: DEFAULT_MAX_TURNS_PER_AGENT,
    defaultPermissionMode: permMode,
  };

  const id = randomUUID();
  const ensembleSession: EnsembleSession = {
    id,
    task,
    config,
    responses: [],
    status: 'running',
    round: 0,
    startTime: new Date().toISOString(),
    _cliPid: process.pid,
  };

  state.saveEnsemble(ensembleSession);

  const ensemble = new Ensemble(ensembleSession, bin, (msg) => {
    info(dim(msg));
  });

  // Poll for injected cues between rounds
  const cuePoller = setInterval(() => {
    const cues = state.drainCues(id);
    for (const cue of cues) {
      ensemble.inject(cue);
      info(cyan(`[cue injected] ${cue}`));
    }
  }, 2_000);

  const cleanup = (): void => {
    clearInterval(cuePoller);
    ensemble.abort();
    ensembleSession.status = 'abandoned';
    ensembleSession.endTime = new Date().toISOString();
    state.saveEnsemble(ensembleSession);
  };

  process.on('SIGINT', () => {
    info(yellow('\n[ensemble] Aborting...'));
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  info(bold(`\n[ensemble:${id.slice(0, 8)}] Starting ${agentCount} agents — max ${maxRounds} rounds`));
  info(`  Task: ${task}`);
  info(`  CWD:  ${cwd}`);
  info(`  ID:   ${id}\n`);

  await ensemble.run();
  clearInterval(cuePoller);

  state.saveEnsemble(ensembleSession);

  const statusStr = ensembleSession.status === 'consensus'
    ? green('consensus')
    : ensembleSession.status === 'error'
    ? red(ensembleSession.status)
    : yellow(ensembleSession.status);

  info(bold(`\n[ensemble:${id.slice(0, 8)}] Finished — ${statusStr}`));
  if (ensembleSession.error) info(red(`  Error: ${ensembleSession.error}`));
  info(`  Rounds completed: ${ensembleSession.round}`);
  info(`  ID: ${id}`);
  info(`\n  Use: clawnductor ensemble score ${id}`);
  info(`  Use: clawnductor ensemble accept ${id}`);
}

function cmdEnsembleStatus(argv: string[]): void {
  const { pos, opt } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor ensemble status <id>');

  const id = pos[0];
  const e = state.getEnsemble(id);
  if (!e) die(`Ensemble "${id}" not found`);

  if (optBool(opt, 'json')) {
    printJson(e);
    return;
  }

  const statusStr = e.status === 'consensus' ? green(e.status)
    : e.status === 'error' ? red(e.status)
    : yellow(e.status);

  console.log(bold(`\n  Ensemble ${dim(id)}`));
  console.log(`  Status:  ${statusStr}`);
  console.log(`  Task:    ${e.task.slice(0, 80)}`);
  console.log(`  Agents:  ${e.config.agents.map((a) => a.name).join(', ')}`);
  console.log(`  Round:   ${e.round} / ${e.config.maxRounds}`);
  console.log(`  Started: ${fmtDate(e.startTime)}`);
  if (e.endTime) console.log(`  Ended:   ${fmtDate(e.endTime)}`);
  if (e.error) console.log(`  Error:   ${red(e.error)}`);

  if (e.responses.length) {
    const lastRound = Math.max(...e.responses.map((r) => r.round));
    const lastResponses = e.responses.filter((r) => r.round === lastRound);
    console.log(bold(`\n  Round ${lastRound} votes:`));
    for (const r of lastResponses) {
      const vote = r.consensus ? green('YES') : red('NO');
      console.log(`  ${r.agent.padEnd(20)} [CONSENSUS: ${vote}]`);
    }
  }
  console.log();
}

function cmdEnsembleAbort(argv: string[]): void {
  const { pos } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor ensemble abort <id>');

  const id = pos[0];
  const e = state.getEnsemble(id);
  if (!e) die(`Ensemble "${id}" not found`);

  if (e.status !== 'running') {
    die(`Ensemble is not running (status: ${e.status})`);
  }

  const pid = e._cliPid;
  if (!pid) die('No CLI PID recorded for this ensemble — send SIGINT to the terminal running it');

  // Guard against state-file tampering and stale-PID reuse. process.kill with
  // pid <= 1 has special meaning (0 = current process group, -1 = every
  // permitted process) and could nuke unrelated processes; pid === process.pid
  // would signal ourselves. Probe with signal 0 first to confirm the PID is
  // alive before sending a real signal — if the OS reused the slot for an
  // unrelated process, we still misfire, but at least we don't blast signals
  // at impossible PIDs.
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
    die(`Refusing to abort: stored CLI PID ${pid} is invalid`);
  }
  try {
    process.kill(pid, 0);
  } catch {
    e.status = 'abandoned';
    e.endTime = new Date().toISOString();
    state.saveEnsemble(e);
    console.log(yellow('Process already gone — marked as abandoned'));
    return;
  }

  try {
    process.kill(pid, 'SIGINT');
    console.log(green(`Abort signal sent to process ${pid}`));
  } catch {
    // Update state directly if process is already gone
    e.status = 'abandoned';
    e.endTime = new Date().toISOString();
    state.saveEnsemble(e);
    console.log(yellow('Process already gone — marked as abandoned'));
  }
}

function cmdEnsembleCue(argv: string[]): void {
  const { pos } = parseArgs(argv);
  if (pos.length < 2) die('Usage: clawnductor ensemble cue <id> <message...>');

  const id = pos[0];
  const message = validateStringField(pos.slice(1).join(' '), 'message');

  const e = state.getEnsemble(id);
  if (!e) die(`Ensemble "${id}" not found`);
  if (e.status !== 'running') info(yellow(`Warning: ensemble is not running (status: ${e.status}) — cue queued anyway`));

  state.queueCue(id, message);
  console.log(green('Cue queued for next round:'));
  console.log(dim(`  ${message}`));
}

async function cmdEnsembleScore(argv: string[]): Promise<void> {
  const { pos, opt } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor ensemble score <id>');

  const id = pos[0];
  const e = state.getEnsemble(id);
  if (!e) die(`Ensemble "${id}" not found`);

  // Build a fresh Ensemble object just to call review()
  const ensemble = new Ensemble(e, 'claude');
  const review = await ensemble.review();

  if (optBool(opt, 'json')) {
    printJson(review);
    return;
  }

  console.log(bold(`\n  Ensemble Score — ${dim(id)}`));
  console.log(`  Status:   ${e.status === 'consensus' ? green(e.status) : yellow(e.status)}`);
  console.log(`  Rounds:   ${review.rounds}`);
  console.log(`  CWD:      ${review.projectDir}`);

  if (review.changedFiles.length) {
    console.log(bold(`\n  Changed files (${review.changedFiles.length}):`));
    for (const f of review.changedFiles.slice(0, 20)) {
      console.log(`  ${green('+' + f.insertions)} ${red('-' + f.deletions)}  ${f.file}`);
    }
  }

  if (review.branches.length) {
    console.log(bold('\n  Ensemble branches:'));
    for (const b of review.branches) console.log(`  ${dim(b)}`);
  }

  if (review.agentSummaries.length) {
    console.log(bold('\n  Agent summaries (last round):'));
    for (const s of review.agentSummaries) {
      const vote = s.consensus ? green('YES') : red('NO');
      console.log(`\n  ${bold(s.agent)} [${vote}]`);
      console.log(dim(s.preview.slice(0, 300)));
    }
  }

  if (review.planExists && review.planContent) {
    console.log(bold('\n  plan.md:'));
    console.log(dim(review.planContent.slice(0, 1000)));
  }
  console.log();
}

async function cmdEnsembleAccept(argv: string[]): Promise<void> {
  const { pos } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor ensemble accept <id>');

  const id = pos[0];
  const e = state.getEnsemble(id);
  if (!e) die(`Ensemble "${id}" not found`);

  info(dim('Accepting ensemble results (merging branches, removing worktrees)...'));

  const ensemble = new Ensemble(e, 'claude');
  const result = await ensemble.accept();
  state.saveEnsemble(e);

  console.log(green('Ensemble accepted.'));
  if (result.mergedBranches.length) console.log(`  Branches merged: ${result.mergedBranches.join(', ')}`);
  if (result.mergeFailed.length) console.log(`  Merge failed: ${result.mergeFailed.join(', ')}`);
  if (result.branchesDeleted.length) console.log(`  Branches deleted: ${result.branchesDeleted.join(', ')}`);
  if (result.worktreesRemoved.length) console.log(`  Worktrees removed: ${result.worktreesRemoved.length}`);
  if (result.planDeleted) console.log('  plan.md deleted');
}

async function cmdEnsembleReject(argv: string[]): Promise<void> {
  const { pos } = parseArgs(argv);
  if (pos.length < 2) die('Usage: clawnductor ensemble reject <id> <feedback...>');

  const id = pos[0];
  const feedback = pos.slice(1).join(' ');
  const e = state.getEnsemble(id);
  if (!e) die(`Ensemble "${id}" not found`);

  const ensemble = new Ensemble(e, 'claude');
  await ensemble.reject(feedback);
  state.saveEnsemble(e);

  console.log(yellow('Ensemble rejected. Feedback recorded in plan.md.'));
  console.log(dim(`  ${feedback}`));
}

// ─── Overture commands ────────────────────────────────────────────────────────

async function cmdOvertureStart(argv: string[]): Promise<void> {
  const { pos, opt } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor overture start <task...> [--cwd <path>] [--model <model>] [--timeout <ms>]');

  const task = pos.join(' ');
  const cwd = validateCwd(optStr(opt, 'cwd') ?? process.cwd(), 'cwd');
  const model = optStr(opt, 'model') ?? 'opus';
  const timeout = optInt(opt, 'timeout') ?? ULTRAPLAN_TIMEOUT_MS;
  const bin = claudeBin(opt);

  const id = randomUUID();
  const sessionName = `overture-${id.slice(0, 8)}`;

  info(bold(`\n[overture:${id.slice(0, 8)}] Starting deep planning...`));
  info(`  Model:   ${resolveModelAlias(model)}`);
  info(`  CWD:     ${cwd}\n`);

  const plan = state.getUltraplan(id) ?? {
    id,
    status: 'running' as const,
    sessionName,
    startTime: new Date().toISOString(),
  };
  state.saveUltraplan(plan);

  const session = new PersistentClaudeSession(
    {
      name: sessionName,
      cwd,
      model,
      permissionMode: 'bypassPermissions',
      appendSystemPrompt: ULTRAPLAN_SYSTEM_PROMPT,
    },
    bin,
  );

  session.on('chunk', (text: string) => process.stdout.write(text));
  session.on('stderr', (text: string) => { if (text.trim()) log(text); });

  process.on('SIGINT', () => {
    session.stop();
    plan.status = 'error';
    plan.error = 'Aborted by user';
    plan.endTime = new Date().toISOString();
    state.saveUltraplan(plan);
    process.exit(130);
  });

  try {
    await session.start();
    const result = await session.send(task, { timeout });
    session.stop();

    if (result.output && !result.output.endsWith('\n')) process.stdout.write('\n');

    plan.status = 'completed';
    plan.plan = result.output;
    plan.endTime = new Date().toISOString();
  } catch (err: unknown) {
    session.stop();
    const msg = err instanceof Error ? err.message : String(err);
    plan.status = msg.includes('timed out') ? 'timeout' : 'error';
    plan.error = msg;
    plan.endTime = new Date().toISOString();
    process.stderr.write(red(`\n[overture] Error: ${msg}\n`));
  }

  state.saveUltraplan(plan);

  info(bold(`\n[overture:${id.slice(0, 8)}] ${plan.status === 'completed' ? green('complete') : red(plan.status)}`));
  info(`  ID: ${id}`);
  info(`  Use: clawnductor overture status ${id}`);
}

function cmdOvertureStatus(argv: string[]): void {
  const { pos, opt } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor overture status <id>');

  const id = pos[0];
  const plan = state.getUltraplan(id);
  if (!plan) die(`Overture "${id}" not found`);

  if (optBool(opt, 'json')) {
    printJson(plan);
    return;
  }

  const statusStr = plan.status === 'completed' ? green(plan.status) : red(plan.status);
  console.log(bold(`\n  Overture ${dim(id)}`));
  console.log(`  Status:  ${statusStr}`);
  console.log(`  Started: ${fmtDate(plan.startTime)}`);
  if (plan.endTime) console.log(`  Ended:   ${fmtDate(plan.endTime)}`);
  if (plan.error) console.log(`  Error:   ${red(plan.error)}`);
  if (plan.plan) {
    console.log(bold('\n  Plan:\n'));
    console.log(plan.plan);
  }
  console.log();
}

// ─── Finale commands ──────────────────────────────────────────────────────────

async function cmdFinaleStart(argv: string[]): Promise<void> {
  const { pos, opt } = parseArgs(argv);

  const cwd = validateCwd(optStr(opt, 'cwd') ?? pos[0] ?? process.cwd(), 'cwd');
  const agentCount = Math.min(20, Math.max(1, optInt(opt, 'agents') ?? 5));
  const duration = optInt(opt, 'duration') ?? 10;
  const focus = optStr(opt, 'focus') ?? 'Find all bugs, security vulnerabilities, and code quality issues';
  const model = optStr(opt, 'model');
  const bin = claudeBin(opt);

  const selectedReviewers: AgentPersona[] = REVIEWER_FLEET.slice(0, agentCount).map((r) => ({
    name: r.name,
    emoji: r.emoji,
    persona: `${r.focus}. ${focus}.`,
    model,
    permissionMode: 'bypassPermissions' as PermissionMode,
  }));

  const id = randomUUID();
  const task = `Conduct a parallel code review of the codebase at ${cwd}. ${focus}. Each reviewer writes findings to reviews/<reviewer>-findings.md and votes [CONSENSUS: YES] when done.`;

  const config: EnsembleConfig = {
    agents: selectedReviewers,
    maxRounds: 2,
    projectDir: cwd,
    agentTimeoutMs: duration * 60_000,
    maxTurnsPerAgent: 20,
    defaultPermissionMode: 'bypassPermissions',
  };

  const ensembleSession: EnsembleSession = {
    id,
    task,
    config,
    responses: [],
    status: 'running',
    round: 0,
    startTime: new Date().toISOString(),
    _cliPid: process.pid,
  };

  const reviewResult = {
    id,
    status: 'running' as 'running' | 'completed' | 'error',
    ensembleId: id,
    agentCount,
    startTime: new Date().toISOString(),
  };
  state.saveEnsemble(ensembleSession);
  state.saveUltrareview(reviewResult);

  const ensemble = new Ensemble(ensembleSession, bin, (msg) => info(dim(msg)));

  process.on('SIGINT', () => {
    ensemble.abort();
    reviewResult.status = 'error';
    state.saveUltrareview({ ...reviewResult, endTime: new Date().toISOString() });
    process.exit(130);
  });

  info(bold(`\n[finale:${id.slice(0, 8)}] Starting ${agentCount} reviewers (${duration}min max)`));
  info(`  CWD:   ${cwd}`);
  info(`  Focus: ${focus}`);
  info(`  ID:    ${id}\n`);
  info(`  Reviewers: ${selectedReviewers.map((r) => r.name).join(', ')}\n`);

  await ensemble.run();
  state.saveEnsemble(ensembleSession);

  // Synthesize findings
  const reviewsDir = path.join(cwd, 'reviews');
  const parts: string[] = ['# Finale Review Findings\n'];
  try {
    if (fs.existsSync(reviewsDir)) {
      for (const f of fs.readdirSync(reviewsDir)) {
        if (f.endsWith('.md')) {
          parts.push(`## ${f}\n`);
          parts.push(fs.readFileSync(path.join(reviewsDir, f), 'utf8'));
          parts.push('');
        }
      }
    }
  } catch {}

  if (parts.length <= 1) {
    const lastRound = Math.max(...ensembleSession.responses.map((r) => r.round), 0);
    for (const r of ensembleSession.responses.filter((x) => x.round === lastRound)) {
      parts.push(`## ${r.agent}\n`, r.content, '');
    }
  }

  const findings = parts.join('\n');
  const finalStatus = (ensembleSession.status === 'consensus' || ensembleSession.status === 'max_rounds')
    ? 'completed' : 'error';

  state.saveUltrareview({
    ...reviewResult,
    status: finalStatus,
    findings,
    endTime: new Date().toISOString(),
  });

  info(bold(`\n[finale:${id.slice(0, 8)}] ${finalStatus === 'completed' ? green('complete') : red('error')}`));
  info(`  ID: ${id}`);
  info(`  Use: clawnductor finale status ${id}`);
}

function cmdFinaleStatus(argv: string[]): void {
  const { pos, opt } = parseArgs(argv);
  if (!pos[0]) die('Usage: clawnductor finale status <id>');

  const id = pos[0];
  const review = state.getUltrareview(id);
  if (!review) die(`Finale review "${id}" not found`);

  if (optBool(opt, 'json')) {
    printJson(review);
    return;
  }

  const statusStr = review.status === 'completed' ? green(review.status) : yellow(review.status);
  console.log(bold(`\n  Finale ${dim(id)}`));
  console.log(`  Status:    ${statusStr}`);
  console.log(`  Reviewers: ${review.agentCount}`);
  console.log(`  Started:   ${fmtDate(review.startTime)}`);
  if (review.endTime) console.log(`  Ended:     ${fmtDate(review.endTime)}`);

  if (review.findings) {
    console.log(bold('\n  Findings:\n'));
    console.log(review.findings);
  }
  console.log();
}

// ─── Purge ────────────────────────────────────────────────────────────────────

async function cmdPurge(argv: string[]): Promise<void> {
  const { opt } = parseArgs(argv);
  const dryRun = !optBool(opt, 'yes');
  const all = optBool(opt, 'all');
  const purgeAll = optBool(opt, 'all-sessions');
  const bin = claudeBin(opt);

  const args = ['project', 'purge', '--yes'];
  if (all) args.push('--all');
  if (dryRun) args.push('--dry-run');

  info(dim(`Running: ${bin} ${args.join(' ')}`));

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);

  try {
    const { stdout, stderr } = await exec(bin, args);
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr ?? String(err));
  }

  if (purgeAll) {
    const sessions = Object.keys(state.getSessions());
    for (const name of sessions) state.deleteSession(name);
    console.log(green(`Cleared ${sessions.length} stored sessions from state`));
  }
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${bold('clawnductor')} v${VERSION} — Claude Code multi-agent CLI

${bold('Usage:')} clawnductor <command> [subcommand] [args...] [options]

${bold('JAM — Persistent sessions')}
  ${cyan('jam start')} <name>            Create a session
    --cwd <path>               Working directory (default: cwd)
    --model <model>            Model alias or ID (opus/sonnet/haiku)
    --permission-mode <mode>   bypassPermissions|acceptEdits|auto|plan
    --effort <level>           low|medium|high|xhigh|max
    --max-turns <n>            Max turns per send
    --allow <tools>            Comma-separated allowed tools
    --disallow <tools>         Comma-separated disallowed tools
    --mcp <paths>              Comma-separated MCP config paths
    --system-prompt <text>     Append system prompt
    --claude-bin <path>        Path to claude binary

  ${cyan('jam play')} <name> <message>   Send message to session (streams response)
    --timeout <ms>             Turn timeout (default: 5min)
    --plan                     Use /plan mode

  ${cyan('jam end')} <name>              Delete session
  ${cyan('jam list')} [--json]           List all sessions
  ${cyan('jam status')} <name> [--json]  Show session details
  ${cyan('jam groove')} <name> <pattern> Search message history (regex)
    --limit <n>                Max results (default: 20)
  ${cyan('jam bridge')} <name> [summary] Compact context (uses --resume)
  ${cyan('jam transpose')} <name> <model> Switch model
  ${cyan('jam rekey')} <name>            Update tool permissions
    --allow <tools>            Add allowed tools
    --disallow <tools>         Add disallowed tools
    --remove <tools>           Remove from allow/disallow lists
    --merge                    Merge with existing (don't replace)
  ${cyan('jam roster')} [--cwd <path>]   List .claude/agents/*.md definitions

${bold('BANDSTAND — Health overview')}
  ${cyan('bandstand')} [--json]          Show all sessions and ensembles

${bold('ENSEMBLE — Multi-agent parallel execution')}
  ${cyan('ensemble start')} <task>       Run agents on a task (foreground, blocking)
    --cwd <path>               Project directory
    --agents <n>               Number of agents (1-8, default: 3)
    --max-rounds <n>           Max rounds (default: 15)
    --model <model>            Model for all agents
    --permission-mode <mode>   Permission mode
    --timeout <ms>             Per-agent timeout

  ${cyan('ensemble status')} <id>        Show ensemble state
  ${cyan('ensemble abort')} <id>         Send abort signal to running ensemble
  ${cyan('ensemble cue')} <id> <msg>     Inject director message (next round)
  ${cyan('ensemble score')} <id>         Show detailed review of results
  ${cyan('ensemble accept')} <id>        Merge results, remove worktrees/branches
  ${cyan('ensemble reject')} <id> <msg>  Mark rejected with feedback

${bold('OVERTURE — Deep planning (ultraplan)')}
  ${cyan('overture start')} <task>       Run planning agent (foreground, streams plan)
    --cwd <path>               Project directory
    --model <model>            Model (default: opus)
    --timeout <ms>             Timeout (default: 30min)
  ${cyan('overture status')} <id>        Show plan

${bold('FINALE — Fleet code review (ultrareview)')}
  ${cyan('finale start')} [cwd]          Run review fleet (foreground, blocking)
    --cwd <path>               Directory to review (or first positional)
    --agents <n>               Number of reviewers (1-20, default: 5)
    --duration <minutes>       Max duration per agent (default: 10)
    --model <model>            Model for reviewers
    --focus <text>             Review focus description
  ${cyan('finale status')} <id>          Show findings

${bold('PURGE — Project state cleanup')}
  ${cyan('purge')} [options]             Run claude project purge
    --yes                      Actually run (omit for dry-run)
    --all                      Purge all projects
    --all-sessions             Also clear stored session state

${bold('Global options')}
  --claude-bin <path>          Claude binary path (or set CLAUDE_BIN env)
  --json                       JSON output (where supported)
  -h, --help                   Show this help
  --version                    Show version

${bold('Examples')}
  clawnductor jam start my-project --cwd ~/code/myapp --model opus
  clawnductor jam play my-project "add error handling to the auth module"
  clawnductor jam status my-project
  clawnductor ensemble start "implement user auth" --cwd ~/code/myapp --agents 3
  clawnductor overture start "add GraphQL API layer" --cwd ~/code/myapp
  clawnductor finale start ~/code/myapp --agents 5 --focus "security review"

${dim('State stored in: ~/.clawnductor/')}
`);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function handleJam(argv: string[]): Promise<void> {
  const sub = argv[0];
  const rest = argv.slice(1);
  switch (sub) {
    case 'start':     await cmdJamStart(rest); break;
    case 'play':      await cmdJamPlay(rest); break;
    case 'end':       await cmdJamEnd(rest); break;
    case 'list':      cmdJamList(rest); break;
    case 'status':    cmdJamStatus(rest); break;
    case 'groove':    cmdJamGroove(rest); break;
    case 'bridge':    await cmdJamBridge(rest); break;
    case 'transpose': cmdJamTranspose(rest); break;
    case 'rekey':     cmdJamRekey(rest); break;
    case 'roster':    cmdJamRoster(rest); break;
    default:          die(`Unknown jam subcommand: ${sub || '(none)'}. Run clawnductor --help`);
  }
}

async function handleEnsemble(argv: string[]): Promise<void> {
  const sub = argv[0];
  const rest = argv.slice(1);
  switch (sub) {
    case 'start':   await cmdEnsembleStart(rest); break;
    case 'status':  cmdEnsembleStatus(rest); break;
    case 'abort':   cmdEnsembleAbort(rest); break;
    case 'cue':     cmdEnsembleCue(rest); break;
    case 'score':   await cmdEnsembleScore(rest); break;
    case 'accept':  await cmdEnsembleAccept(rest); break;
    case 'reject':  await cmdEnsembleReject(rest); break;
    default:        die(`Unknown ensemble subcommand: ${sub || '(none)'}. Run clawnductor --help`);
  }
}

async function handleOverture(argv: string[]): Promise<void> {
  const sub = argv[0];
  const rest = argv.slice(1);
  switch (sub) {
    case 'start':  await cmdOvertureStart(rest); break;
    case 'status': cmdOvertureStatus(rest); break;
    default:       die(`Unknown overture subcommand: ${sub || '(none)'}. Run clawnductor --help`);
  }
}

async function handleFinale(argv: string[]): Promise<void> {
  const sub = argv[0];
  const rest = argv.slice(1);
  switch (sub) {
    case 'start':  await cmdFinaleStart(rest); break;
    case 'status': cmdFinaleStatus(rest); break;
    default:       die(`Unknown finale subcommand: ${sub || '(none)'}. Run clawnductor --help`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    printHelp();
    return;
  }
  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    console.log(`clawnductor v${VERSION}`);
    return;
  }

  const cmd = argv[0];
  const rest = argv.slice(1);

  try {
    switch (cmd) {
      case 'jam':       await handleJam(rest); break;
      case 'bandstand': cmdBandstand(rest); break;
      case 'ensemble':  await handleEnsemble(rest); break;
      case 'overture':  await handleOverture(rest); break;
      case 'finale':    await handleFinale(rest); break;
      case 'purge':     await cmdPurge(rest); break;
      default:          die(`Unknown command: ${cmd}. Run clawnductor --help`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(red(`Error: ${msg}\n`));
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
