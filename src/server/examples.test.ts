import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeShareFragment, normalizeModel, toSql, validateModel } from '../core';
import { example } from './examples';

const dir = 'site/examples';
const models = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('example models', () => {
  it.each(models)('%s is valid, its DDL runs in PostgreSQL, and its share link opens it', async (file) => {
    const text = readFileSync(`${dir}/${file}`, 'utf8');
    const m = normalizeModel(JSON.parse(text));
    expect(validateModel(m).filter((i) => i.level !== 'info')).toEqual([]);

    const db = new PGlite();
    await db.exec(toSql(m, { dialect: 'postgres' }));
    const tables = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
    expect(tables.rows[0].n).toBe(m.entities.length);

    const page = example(text, '', `examples/${file.replace(/\.json$/, '')}`);
    const fragment = /\(https:\/\/entitymodel\.com\/(#\/share\/[^)]+)\)/.exec(page.markdown)![1];
    expect(await decodeShareFragment(fragment)).toEqual(m);
    expect(page.svg).toMatch(/^<\?xml[^]*<svg [^>]*><style>[^]*<\/svg>\n$/);
  });
});
