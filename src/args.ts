/**
 * CLI argument parser — zero dependencies, no shell needed.
 *
 * Handles:
 *   --key value      → opt.key = 'value'
 *   --key            → opt.key = true
 *   -k value         → opt.k  = 'value'
 *   -k               → opt.k  = true
 *   --               → rest are positional
 *   bare strings     → positional
 */

export interface ParsedArgs {
  pos: string[];
  opt: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const pos: string[] = [];
  const opt: Record<string, string | boolean> = {};
  let i = 0;

  while (i < argv.length) {
    const a = argv[i];

    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }

    if (a.startsWith('--') && a.length > 2) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        opt[key] = next;
        i += 2;
      } else {
        opt[key] = true;
        i++;
      }
    } else if (a.startsWith('-') && a.length === 2 && a !== '-') {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        opt[key] = next;
        i += 2;
      } else {
        opt[key] = true;
        i++;
      }
    } else {
      pos.push(a);
      i++;
    }
  }

  return { pos, opt };
}

export function optStr(
  opt: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const v = opt[key];
  return typeof v === 'string' ? v : undefined;
}

export function optBool(
  opt: Record<string, string | boolean>,
  key: string,
): boolean {
  return opt[key] === true || opt[key] === 'true';
}

export function optInt(
  opt: Record<string, string | boolean>,
  key: string,
  defaultVal?: number,
): number | undefined {
  const v = optStr(opt, key);
  if (v === undefined) return defaultVal;
  if (!/^-?\d+$/.test(v.trim())) throw new Error(`--${key} must be an integer, got: ${v}`);
  const n = parseInt(v, 10);
  return n;
}
