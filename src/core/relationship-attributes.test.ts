import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { buildDocTables, createModel, deriveTab, diffViews, fromSql, relationalPlan, toSql, validateModel, type Attribute, type DataModel, type Entity, type Relationship } from '.';

const entity = (name: string, attributes: Attribute[]): Entity => ({ name, display_name: name[0].toUpperCase() + name.slice(1), entity_type: 'standard', color_code: '#000', attributes });
const key = (name: string): Attribute => ({ name, label: name, type: 'BIGINT', is_primary_key: true, required: true });
const rel = (r: Partial<Relationship> & Pick<Relationship, 'name' | 'source' | 'target' | 'cardinality'>): Relationship => ({ forward_label: 'Links', bidirectional: false, ...r });

/** Students enroll in courses (N:N, with a grade and a date); each student has an advisor (N:1, since when). */
function school(): DataModel {
  const m = createModel('school', 'School');
  m.entities.push(
    entity('student', [key('student_id'), { name: 'name', label: 'Name', type: 'STRING', is_label: true, required: true }]),
    entity('course', [key('course_id'), { name: 'title', label: 'Title', type: 'STRING', is_label: true }]),
    entity('advisor', [key('advisor_id'), { name: 'name', label: 'Name', type: 'STRING', is_label: true }]),
  );
  m.relationships.push(
    rel({
      name: 'enrollment',
      source: 'student',
      target: 'course',
      cardinality: 'N:N',
      forward_label: 'Enrolled In',
      attributes: [
        { name: 'grade', label: 'Grade', type: 'DECIMAL', precision: 4, scale: 1, required: true },
        { name: 'enrolled_on', label: 'Enrolled On', type: 'DATE' },
      ],
    }),
    rel({ name: 'advised_by', source: 'student', target: 'advisor', cardinality: 'N:1', forward_label: 'Advised By', attributes: [{ name: 'since', label: 'Since', type: 'DATE', required: true, description: 'When the advisor took the student on.' }] }),
  );
  return m;
}

describe('relationship attributes', () => {
  it('become junction columns for N:N and child columns otherwise, keeping their types', () => {
    const plan = relationalPlan(school());
    const junction = plan.tables.find((t) => t.relationship === 'enrollment')!;
    expect(junction.columns.map((c) => c.name)).toEqual(['student_id', 'course_id', 'grade', 'enrolled_on']);
    const grade = junction.columns.find((c) => c.name === 'grade')!;
    expect(grade).toMatchObject({ notNull: true, pk: false, attr: { type: 'DECIMAL', precision: 4, scale: 1 } });
    // On the child table, a required relationship attribute can't be NOT NULL: a student without an advisor has no "since".
    const since = plan.tables.find((t) => t.name === 'student')!.columns.find((c) => c.name === 'since')!;
    expect(since).toMatchObject({ notNull: false, attr: { type: 'DATE', description: 'When the advisor took the student on.' } });
  });

  it('produce SQL that runs, on PostgreSQL', async () => {
    const sql = toSql(school(), { dialect: 'postgres' });
    expect(sql).toMatch(/grade NUMERIC\(4,1\) NOT NULL/);
    const db = new PGlite();
    await db.exec(sql);
    const cols = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'enrollment' ORDER BY ordinal_position");
    expect(cols.rows.map((r) => r.column_name)).toEqual(['student_id', 'course_id', 'grade', 'enrolled_on']);
    await db.close();
  });

  it('never duplicate a column name', () => {
    const m = school();
    m.relationships[0].attributes!.push({ name: 'student_id', label: 'x', type: 'STRING' });
    m.relationships[1].attributes!.push({ name: 'name', label: 'x', type: 'STRING' });
    const plan = relationalPlan(m);
    for (const t of plan.tables) expect(new Set(t.columns.map((c) => c.name)).size).toBe(t.columns.length);
    const codes = validateModel(m).map((i) => i.code);
    expect(codes).toContain('rel.attr_clash');
  });

  it('are validated', () => {
    const m = school();
    m.relationships[0].attributes!.push({ name: 'grade', label: 'Again', type: 'STRING' }, { name: '9lives', label: 'Bad', type: 'STRING' }, { name: 'meta', label: 'Meta', type: 'STRUCT' });
    const codes = validateModel(m)
      .map((i) => i.code)
      .filter((c) => c.startsWith('rel.attr'));
    expect(codes.sort()).toEqual(['rel.attr_duplicate', 'rel.attr_name', 'rel.attr_type']);
    expect(validateModel(school()).filter((i) => i.code.startsWith('rel.attr'))).toEqual([]);
  });

  it('appear in the design-doc tables and in tab compare', () => {
    const tables = buildDocTables(school(), { sections: ['relationships'] });
    const rels = tables.find((t) => t.id === 'relationships')!;
    expect(rels.rows.find((r) => r[0] === 'enrollment')![rels.columns.indexOf('Attributes')]).toBe('grade, enrolled_on');
    expect(tables.find((t) => t.id === 'relationship-attributes')!.rows).toEqual([
      ['enrollment', 'grade', 'DECIMAL(4,1)', 'Yes', 'junction table', ''],
      ['enrollment', 'enrolled_on', 'DATE', '', 'junction table', ''],
      ['advised_by', 'since', 'DATE', 'Yes', 'Student', 'When the advisor took the student on.'],
    ]);
    const after = school();
    after.relationships[0].attributes![0].type = 'INT';
    after.relationships[0].attributes!.push({ name: 'credits', label: 'Credits', type: 'INT' });
    after.relationships[1].attributes = [];
    const d = diffViews(school(), after, 'none');
    expect(d.relationships.find((r) => r.name === 'enrollment')!.details).toEqual(['attribute grade: DECIMAL(4,1) required → INT required', 'attribute credits added (INT)']);
    expect(d.relationships.find((r) => r.name === 'advised_by')!.details).toEqual(['attribute since removed']);
  });

  it('become real columns when deriving a physical tab, and come back when deriving a logical one', () => {
    const physical = deriveTab(school(), 'physical').content;
    const since = physical.entities.find((e) => e.name === 'student')!.attributes.find((a) => a.name === 'since')!;
    expect(since.type).toBe('DATE');
    expect(since.required).toBeFalsy();
    expect(physical.relationships.every((r) => !r.attributes?.length)).toBe(true);
    const junction = physical.entities.find((e) => e.attributes.some((a) => a.name === 'grade'))!;
    expect(junction.attributes.map((a) => a.name)).toEqual(['student_id', 'course_id', 'grade', 'enrolled_on']);

    const logical = deriveTab({ ...createModel('p', 'P'), ...physical }, 'logical').content;
    const nn = logical.relationships.find((r) => r.cardinality === 'N:N')!;
    expect(nn.attributes!.map((a) => a.name)).toEqual(['grade', 'enrolled_on']);
  });

  it('come from the extra columns of a link table in SQL', () => {
    const { model } = fromSql(`
      CREATE TABLE student (student_id BIGINT PRIMARY KEY, name TEXT);
      CREATE TABLE course (course_id BIGINT PRIMARY KEY, title TEXT);
      CREATE TABLE enrollment (student_id BIGINT REFERENCES student, course_id BIGINT REFERENCES course, grade NUMERIC(4,1) NOT NULL, PRIMARY KEY (student_id, course_id));
    `);
    const nn = model.relationships.find((r) => r.cardinality === 'N:N')!;
    expect(nn.attributes).toMatchObject([{ name: 'grade', type: 'DECIMAL', precision: 4, scale: 1, required: true }]);
  });
});
