// Minimal deterministic YAML writer (block style) for dbt and data-contract exports. Strings are quoted
// whenever plain YAML would read them as something else.
type Y = string | number | boolean | null | undefined | Y[] | { [k: string]: Y };

const PLAIN = /^[A-Za-z_./][A-Za-z0-9_ ./()'-]*$/;
const AMBIGUOUS = /^(true|false|yes|no|on|off|null|~|y|n)$/i;

function scalar(v: string | number | boolean | null): string {
  if (v === null) return 'null';
  if (typeof v !== 'string') return String(v);
  if (v !== '' && PLAIN.test(v) && !AMBIGUOUS.test(v) && !/\s$/.test(v) && !/^\d/.test(v)) return v;
  return JSON.stringify(v);
}

const isEmpty = (v: Y) => v === undefined || (Array.isArray(v) && !v.length) || (v !== null && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).some((k) => (v as any)[k] !== undefined));

function block(v: Y, indent: string): string {
  if (Array.isArray(v))
    return v
      .map((item) => {
        if (item !== null && typeof item === 'object' && !isEmpty(item)) {
          const inner = block(item, indent + '  ');
          return `${indent}- ${inner.slice(indent.length + 2)}`;
        }
        return `${indent}- ${isEmpty(item) ? (Array.isArray(item) ? '[]' : '{}') : scalar(item as any)}`;
      })
      .join('\n');
  return Object.entries(v as Record<string, Y>)
    .filter(([, x]) => x !== undefined)
    .map(([k, x]) => {
      const key = PLAIN.test(k) && !AMBIGUOUS.test(k) ? k : JSON.stringify(k);
      if (x !== null && typeof x === 'object') return isEmpty(x) ? `${indent}${key}: ${Array.isArray(x) ? '[]' : '{}'}` : `${indent}${key}:\n${block(x, indent + '  ')}`;
      return `${indent}${key}: ${scalar(x as any)}`;
    })
    .join('\n');
}

export function toYaml(v: Record<string, Y>, header?: string): string {
  return `${header ? header.split('\n').map((l) => `# ${l}`).join('\n') + '\n' : ''}${block(v, '')}\n`;
}
