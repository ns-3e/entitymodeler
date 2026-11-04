import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  SOURCE_URL,
  createModel,
  createRelationship,
  detectImportFormat,
  fromDbml,
  fromSql,
  importModelText,
  inferForeignKey,
  issueCounts,
  normalizeModel,
  renameAttribute,
  serializeModel,
  toDbml,
  toMermaid,
  toSql,
  validateModel,
  type DataModel,
  type SqlDialect,
} from '..';

const demoText = readFileSync(new URL('../fixtures/supplier.model.json', import.meta.url), 'utf8');
const demo = (): DataModel => normalizeModel(JSON.parse(demoText));
const DIALECTS: SqlDialect[] = ['postgres', 'mysql', 'snowflake', 'databricks'];
const summary = (m: DataModel) => ({
  entities: m.entities
    .map((e) => `${e.name}:${e.entity_type}:${e.dependent_reference?.parent || ''}:${e.reference_values?.length || 0}:${e.attributes.filter((a) => a.is_primary_key).map((a) => a.name)}`)
    .sort(),
  relationships: m.relationships.map((r) => `${r.name}:${r.source}>${r.target}:${r.cardinality}:${r.foreign_key || ''}`).sort(),
});

describe('SQL export', () => {
  it.each(DIALECTS)('%s round-trips the demo model', (dialect) => {
    const back = fromSql(toSql(demo(), { dialect })).model;
    expect(summary(back)).toEqual(summary(demo()));
    expect(issueCounts(validateModel(back)).error).toBe(0);
    const attrs = (m: DataModel) => m.entities.flatMap((e) => e.attributes.map((a) => `${e.name}.${a.name}`)).sort();
    // Relationship attributes become columns on the child table, so the import may have more — never fewer.
    expect(attrs(back)).toEqual(expect.arrayContaining(attrs(demo())));
  });

  it('runs on real PostgreSQL, with enforced keys and seeded reference values', async () => {
    const db = new PGlite();
    await db.exec(toSql(demo(), { dialect: 'postgres' }));
    const states = await db.query<{ n: number }>('select count(*)::int as n from state');
    expect(states.rows[0].n).toBe(6);
    await expect(db.exec(`insert into state (state_code, state_name, country_code) values ('XX', 'Nowhere', 'ZZ')`)).rejects.toThrow(/foreign key/);
    await db.close();
  });

  it('puts the credit line first and can skip reference values', () => {
    for (const dialect of DIALECTS) {
      const sql = toSql(demo(), { dialect, includeValues: false });
      expect(sql.split('\n').slice(0, 4).join('\n')).toContain('Made with EntityModel.com');
      expect(sql).not.toMatch(/INSERT INTO/);
    }
  });

  it('escapes literals per dialect', () => {
    const m = demo();
    m.entities.find((e) => e.name === 'country')!.reference_values![0].country_name = `O'Brien \\ Co`;
    expect(toSql(m, { dialect: 'postgres' })).toContain(`'O''Brien \\ Co'`);
    expect(toSql(m, { dialect: 'mysql' })).toContain(`'O''Brien \\\\ Co'`);
  });

  it('writes N:N relationships as junction tables and reads them back', () => {
    const m = createModel('shop', 'Shop');
    m.entities.push(
      { name: 'order', display_name: 'Order', entity_type: 'standard', color_code: '#000000', attributes: [{ name: 'order_id', label: 'Order ID', type: 'BIGINT', is_primary_key: true }, { name: 'order_name', label: 'Name', type: 'STRING', is_label: true }] },
      { name: 'product', display_name: 'Product', entity_type: 'standard', color_code: '#000000', attributes: [{ name: 'product_id', label: 'Product ID', type: 'BIGINT', is_primary_key: true }, { name: 'product_name', label: 'Name', type: 'STRING', is_label: true }] },
    );
    m.relationships.push({ ...createRelationship(m, 'order', 'product'), name: 'order_line', cardinality: 'N:N', bidirectional: false, attributes: [{ name: 'quantity', label: 'Quantity', type: 'INT' }] });
    const sql = toSql(m, { dialect: 'postgres' });
    expect(sql).toMatch(/CREATE TABLE "?order_line"? \(/);
    expect(sql).toMatch(/"order"/); // reserved word quoted
    const back = fromSql(sql).model;
    expect(back.entities.map((e) => e.name).sort()).toEqual(['order', 'product']);
    expect(back.relationships).toMatchObject([{ name: 'order_line', cardinality: 'N:N', source: 'order', target: 'product' }]);
    expect(back.relationships[0].attributes?.map((a) => a.name)).toEqual(['quantity']);
  });
});

describe('SQL import', () => {
  it('reads PostgreSQL: inline references, COMMENT ON, arrays, serial, quoted names', () => {
    const { model, warnings } = fromSql(`
      CREATE TABLE IF NOT EXISTS public.customer (
        id SERIAL PRIMARY KEY,
        "Full Name" VARCHAR(200) NOT NULL,
        tags TEXT[],
        key TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
      CREATE TABLE orders (
        order_id BIGINT PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
        total NUMERIC(12,2)
      );
      COMMENT ON TABLE customer IS 'People who buy';
      COMMENT ON COLUMN public.customer.tags IS 'Free-form tags';
      CREATE INDEX idx_orders_customer ON orders (customer_id);
    `);
    const c = model.entities.find((e) => e.name === 'customer')!;
    expect(c.description).toBe('People who buy');
    expect(c.attributes.map((a) => a.name)).toEqual(['id', 'Full_Name', 'tags', 'key', 'created_at']);
    expect(c.attributes.find((a) => a.name === 'tags')).toMatchObject({ type: 'STRING', is_array: true, description: 'Free-form tags' });
    expect(c.attributes.find((a) => a.name === 'created_at')!.type).toBe('TIMESTAMP');
    expect(c.attributes.find((a) => a.name === 'Full_Name')).toMatchObject({ required: true, is_label: true });
    expect(model.relationships).toMatchObject([{ source: 'orders', target: 'customer', cardinality: 'N:1', foreign_key: 'customer_id' }]);
    // Money keeps its precision: NUMERIC(p,s) is DECIMAL, not DOUBLE.
    expect(model.entities.find((e) => e.name === 'orders')!.attributes.find((a) => a.name === 'total')!.type).toBe('DECIMAL');
    expect(warnings.join(' ')).toMatch(/CREATE INDEX/);
  });

  it('reads MySQL: backticks, inline and table comments, KEY indexes, ENGINE options', () => {
    const { model } = fromSql(`
      CREATE TABLE \`order_status\` (
        \`code\` varchar(20) NOT NULL COMMENT 'Status code',
        \`label\` varchar(100) NOT NULL,
        PRIMARY KEY (\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Order lifecycle states';
      CREATE TABLE \`orders\` (
        \`id\` int unsigned NOT NULL AUTO_INCREMENT,
        \`status\` varchar(20) NOT NULL,
        \`is_paid\` tinyint(1) NOT NULL DEFAULT '0',
        PRIMARY KEY (\`id\`),
        KEY \`idx_status\` (\`status\`),
        CONSTRAINT \`fk_orders_status\` FOREIGN KEY (\`status\`) REFERENCES \`order_status\` (\`code\`)
      ) ENGINE=InnoDB;
    `);
    const status = model.entities.find((e) => e.name === 'order_status')!;
    expect(status).toMatchObject({ entity_type: 'reference', description: 'Order lifecycle states' });
    expect(status.attributes[0].description).toBe('Status code');
    const orders = model.entities.find((e) => e.name === 'orders')!;
    expect(orders.attributes.map((a) => a.name)).toEqual(['id', 'status', 'is_paid']);
    expect(orders.attributes.find((a) => a.name === 'is_paid')!.type).toBe('BOOLEAN');
    // FK into a reference list becomes a reference lookup, not a relationship
    expect(orders.attributes.find((a) => a.name === 'status')).toMatchObject({ type: 'REFERENCE_ENTITY', reference: { entity: 'order_status', output_attribute: 'code' } });
    expect(model.relationships).toEqual([]);
  });

  it('reads Snowflake: VARIANT, NUMBER, COMMENT =, CREATE OR REPLACE', () => {
    const { model } = fromSql(`
      create or replace transient table analytics.events (
        event_id number(38,0) not null primary key,
        payload variant comment 'raw JSON',
        tags array
      ) comment = 'Event stream';
    `);
    const e = model.entities[0];
    expect(e).toMatchObject({ name: 'events', description: 'Event stream' });
    // NUMBER(38,0) is how Snowflake writes BIGINT.
    expect(e.attributes.find((a) => a.name === 'event_id')).toMatchObject({ type: 'BIGINT', is_primary_key: true });
    expect(e.attributes.find((a) => a.name === 'payload')!.description).toMatch(/raw JSON.*VARIANT/);
    expect(e.attributes.find((a) => a.name === 'tags')!.is_array).toBe(true);
  });

  it('reads Databricks: STRUCT and ARRAY<STRUCT>, USING DELTA, informational constraints', () => {
    const { model } = fromSql(`
      CREATE TABLE main.crm.contact (
        contact_id STRING NOT NULL,
        address STRUCT<street: STRING, city: STRING, zip: INT>,
        phones ARRAY<STRUCT<kind: STRING, number: STRING>>,
        CONSTRAINT pk_contact PRIMARY KEY (contact_id)
      ) USING DELTA COMMENT 'CRM contacts' TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported');
    `);
    const e = model.entities[0];
    expect(e.description).toBe('CRM contacts');
    expect(e.attributes.find((a) => a.name === 'contact_id')!.is_primary_key).toBe(true);
    const address = e.attributes.find((a) => a.name === 'address')!;
    expect(address).toMatchObject({ type: 'STRUCT', struct_type: 'address' });
    expect(e.struct_types!.find((s) => s.name === 'address')!.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['street:STRING', 'city:STRING', 'zip:INT']);
    expect(e.attributes.find((a) => a.name === 'phones')).toMatchObject({ type: 'STRUCT', is_array: true });
    expect(issueCounts(validateModel(model)).error).toBe(0);
  });

  it('never throws on junk and says what it skipped', () => {
    const r = fromSql('SELECT 1; GRANT ALL ON x TO y; this is not sql (((');
    expect(r.model.entities).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/No CREATE TABLE/);
  });
});

describe('DBML', () => {
  it('round-trips the demo model (structure; values are not part of DBML)', () => {
    const dbml = toDbml(demo());
    expect(dbml.split('\n')[1]).toBe('// Made with EntityModel.com');
    const back = fromDbml(dbml).model;
    const strip = (s: ReturnType<typeof summary>) => ({ ...s, entities: s.entities.map((x) => x.replace(/:\d+:/, ':')) });
    expect(strip(summary(back))).toEqual(strip(summary(demo())));
    expect(back.entities.find((e) => e.name === 'supplier')!.color_code).toBe(demo().entities.find((e) => e.name === 'supplier')!.color_code);
  });

  it('reads a dbdiagram.io-style file: enums, aliases, inline and block refs, composite keys, notes', () => {
    const { model, warnings } = fromDbml(`
      // Shop
      Project shop { database_type: 'PostgreSQL'
        Note: '''
          Online shop.
        '''
      }
      Enum order_status { created [note: 'new'] paid shipped }
      Table users as U [headercolor: #3498DB] {
        id integer [pk, increment]
        full_name varchar [not null, note: 'Display name']
        created_at timestamp
        Note: 'Registered users'
      }
      Table orders {
        id integer [pk]
        user_id integer [ref: > U.id]
        status order_status
      }
      Table order_items {
        order_id integer
        product_code "varchar(32)"
        quantity int
        indexes { (order_id, product_code) [pk] }
      }
      Ref items_of_order { order_items.order_id > orders.id }
      Ref: users.id - user_profiles.user_id
    `);
    expect(model.description).toBe('Online shop.');
    const users = model.entities.find((e) => e.name === 'users')!;
    expect(users).toMatchObject({ description: 'Registered users', color_code: '#3498DB' });
    expect(users.attributes.find((a) => a.name === 'full_name')).toMatchObject({ required: true, description: 'Display name', is_label: true });
    expect(model.entities.find((e) => e.name === 'order_status')).toMatchObject({ entity_type: 'reference', reference_values: [{ order_status_code: 'created' }, { order_status_code: 'paid' }, { order_status_code: 'shipped' }] });
    expect(model.entities.find((e) => e.name === 'orders')!.attributes.find((a) => a.name === 'status')).toMatchObject({ type: 'REFERENCE_ENTITY', reference: { entity: 'order_status' } });
    expect(model.entities.find((e) => e.name === 'order_items')!.attributes.filter((a) => a.is_primary_key).map((a) => a.name)).toEqual(['order_id', 'product_code']);
    expect(model.relationships.map((r) => `${r.name}:${r.source}>${r.target}:${r.foreign_key}`).sort()).toEqual(['items_of_order:order_items>orders:order_id', 'orders_to_users:orders>users:user_id']);
    expect(warnings.join(' ')).toMatch(/user_profiles/);
  });
});

describe('Mermaid', () => {
  it('writes an erDiagram with the credit, every entity and crow’s-foot relationships', () => {
    const mmd = toMermaid(demo());
    expect(mmd).toContain('%% Made with EntityModel.com');
    expect(mmd).toContain('erDiagram');
    for (const e of demo().entities) expect(mmd).toContain(`  ${e.name} {`);
    expect(mmd).toContain('supplier_sites }o--|| supplier : "Operated By"');
    expect(mmd).toContain('state }o..|| country : "depends on"');
    expect(mmd).toMatch(/string supplier_id PK/);
  });
});

describe('format detection', () => {
  it('tells DBML from SQL', () => {
    expect(detectImportFormat('Table users {\n id int\n}')).toBe('dbml');
    expect(detectImportFormat('Ref: a.b > c.d')).toBe('dbml');
    expect(detectImportFormat('CREATE TABLE users (id int);')).toBe('sql');
    expect(importModelText('create table t (id int primary key)').format).toBe('sql');
  });
});

describe('relationship foreign keys', () => {
  it('infers the key column by naming convention, including self-references', () => {
    const m = demo();
    for (const r of m.relationships) delete r.foreign_key;
    expect(inferForeignKey(m, m.relationships.find((r) => r.name === 'site_of_supplier')!)).toBe('supplier_id');
    expect(inferForeignKey(m, m.relationships.find((r) => r.name === 'subsidiary_of')!)).toBe('parent_supplier_id');
  });

  it('follows attribute renames and is checked by validation', () => {
    const m = demo();
    renameAttribute(m, 'supplier_sites', 'supplier_id', 'vendor_id');
    expect(m.relationships.find((r) => r.name === 'site_of_supplier')!.foreign_key).toBe('vendor_id');
    m.relationships.find((r) => r.name === 'site_of_supplier')!.foreign_key = 'nope';
    expect(validateModel(m).some((i) => i.code === 'rel.fk')).toBe(true);
  });
});

describe('branding', () => {
  it('stamps the source URL into every model file', () => {
    expect(createModel('x', 'X').source).toBe(SOURCE_URL);
    const m = normalizeModel({ name: 'old', title: 'Old', entities: [] });
    expect(m.source).toBe(SOURCE_URL);
    expect(Object.keys(JSON.parse(serializeModel(m))).slice(0, 3)).toEqual(['format', 'format_version', 'source']);
  });
});

describe('DECIMAL and UNIQUE', () => {
  it('import with precision and uniqueness, and export them per dialect', () => {
    const m = fromSql(`CREATE TABLE price (id BIGINT PRIMARY KEY, sku VARCHAR(40) UNIQUE, amount NUMERIC(12,2) NOT NULL, rate NUMBER(10,0), cost MONEY);`).model;
    const a = Object.fromEntries(m.entities[0].attributes.map((x) => [x.name, x]));
    expect(a.amount).toMatchObject({ type: 'DECIMAL', precision: 12, scale: 2, required: true });
    expect(a.rate.type).toBe('INT');
    expect(a.cost).toMatchObject({ type: 'DECIMAL', precision: 19, scale: 4 });
    expect(a.sku.unique).toBe(true);
    expect(toSql(m, { dialect: 'postgres' })).toContain('"amount" NUMERIC(12,2) NOT NULL'.replace(/"/g, ''));
    expect(toSql(m, { dialect: 'snowflake' })).toContain('NUMBER(12,2)');
    expect(toSql(m, { dialect: 'databricks' })).toContain('DECIMAL(12,2)');
    expect(toSql(m, { dialect: 'postgres' })).toMatch(/UNIQUE \(sku\)/);
    // Round trip keeps them.
    const back = fromSql(toSql(m, { dialect: 'snowflake' })).model.entities[0].attributes;
    expect(back.find((x) => x.name === 'amount')).toMatchObject({ type: 'DECIMAL', precision: 12, scale: 2 });
    expect(back.find((x) => x.name === 'id')!.type).toBe('BIGINT');
  });
});
