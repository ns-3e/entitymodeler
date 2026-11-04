export * from './sqlTypes';
export { relationalPlan, keyColumnName, type RelPlan, type RelTable, type RelColumn, type RelForeignKey } from './relational';
export { toSql, type SqlOptions } from './sql';
export { fromSql, type ImportResult } from './sqlParse';
export { toDbml, fromDbml } from './dbml';
export { toMermaid } from './mermaid';
export * from './catalog';
export { toDbt, toJsonSchema, toAvro, toOdcs } from './contracts';
import { fromDbml } from './dbml';
import { fromSql, type ImportResult } from './sqlParse';

export type ImportFormat = 'sql' | 'dbml';

/** DBML has Table/Ref/Enum blocks with braces; everything else is treated as SQL. */
export function detectImportFormat(text: string): ImportFormat {
  return /^\s*(Table|Enum|TableGroup|Project)\s+[^\s{]+[^{]*\{/im.test(text) || /^\s*Ref\s*\w*\s*:/im.test(text) ? 'dbml' : 'sql';
}

/** Import SQL DDL or DBML (auto-detected unless given). */
/** `keepJunctions` keeps link tables as tables, for importing into a physical tab (a faithful copy). */
export function importModelText(text: string, opts: { format?: ImportFormat; title?: string; keepJunctions?: boolean } = {}): ImportResult & { format: ImportFormat } {
  const format = opts.format || detectImportFormat(text);
  return { ...(format === 'dbml' ? fromDbml(text, opts) : fromSql(text, opts)), format };
}
