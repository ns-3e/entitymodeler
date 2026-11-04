import { describe, expect, it } from 'vitest';
import { MAIN_TAB, addTab, applyOps, buildDocTables, deriveTab, fromSql, matchTerm, mergeTerms, newTerm, normalizeModel, refreshSnapshot, suggestLinks, tabView, toSql, validateModel, type DataModel } from '.';

const DDL = `CREATE TABLE tbl_customers (cust_id BIGINT PRIMARY KEY, CustNm TEXT, email TEXT);`;
const terms = [newTerm('Customer', 'A person or company that buys from us.', { id: 'term_cust', synonyms: ['Client'] }), newTerm('Customer Name', 'The legal name of a customer.', { id: 'term_cname' })];
const model = () => normalizeModel(fromSql(DDL, { title: 'Shop' }).model);

describe('glossary', () => {
  it('matches names and synonyms the way derivation normalizes them', () => {
    expect(matchTerm(terms, 'CustNm')?.id).toBe('term_cname');
    expect(matchTerm(terms, 'client')?.id).toBe('term_cust');
    expect(suggestLinks(model(), terms).map((x) => `${x.entity}.${x.attribute ?? ''}:${x.term.id}`)).toEqual(['tbl_customers.CustNm:term_cname']);
  });

  it('links terms with ops, carries them in the snapshot, and uses them in docs and Databricks tags', () => {
    const r = applyOps(model(), [
      { op: 'link_term', entity: 'tbl_customers', term: terms[0] },
      { op: 'link_term', entity: 'tbl_customers', attribute: 'CustNm', term: terms[1] },
    ]);
    expect(r.ok).toBe(true);
    const m = (r as { doc: DataModel }).doc;
    expect(m.glossary_snapshot!.map((t) => t.id)).toEqual(['term_cust', 'term_cname']);
    expect(validateModel(m).some((i) => i.code === 'term.unknown')).toBe(false);
    const dict = buildDocTables(m, { sections: ['attributes'] })[0];
    expect(dict.rows.find((row) => row[1] === 'CustNm')!.at(-1)).toBe('Customer Name: The legal name of a customer.');
    expect(buildDocTables(m, { sections: ['glossary'] })[0].rows).toEqual([
      ['Customer', 'A person or company that buys from us.', 'Client', 'draft', 'tbl_customers'],
      ['Customer Name', 'The legal name of a customer.', '', 'draft', 'tbl_customers.CustNm'],
    ]);
    expect(toSql(m, { dialect: 'databricks' })).toContain("SET TAGS ('business_term' = 'Customer Name');");
    // Unlinking drops the term from the snapshot on refresh; unknown links are flagged.
    const r2 = applyOps(m, [{ op: 'link_term', entity: 'tbl_customers', attribute: 'CustNm', term: null }]);
    const m2 = (r2 as { doc: DataModel }).doc;
    expect(refreshSnapshot(m2, terms)).toBe(true);
    expect(m2.glossary_snapshot!.map((t) => t.id)).toEqual(['term_cust']);
    m2.entities[0].attributes[0].term = 'nope';
    expect(validateModel(m2).some((i) => i.code === 'term.unknown')).toBe(true);
  });

  it('refreshes definitions from the shared glossary across tabs, and merges newer terms', () => {
    const m = model();
    m.entities[0].term = 'term_cust';
    addTab(m, { name: 'Logical', kind: 'logical', derived_from: MAIN_TAB }, deriveTab(tabView(m), 'logical').content);
    const edited = { ...terms[0], definition: 'Updated.', updated_at: '2999-01-01T00:00:00.000Z' };
    refreshSnapshot(m, [edited]);
    expect(m.glossary_snapshot).toEqual([edited]);
    expect(mergeTerms(terms, [edited]).find((t) => t.id === 'term_cust')!.definition).toBe('Updated.');
    expect(mergeTerms([edited], [terms[0]]).find((t) => t.id === 'term_cust')!.definition).toBe('Updated.');
  });
});

describe('review comments', () => {
  it('add, reply, resolve, and follow renames', () => {
    const r = applyOps(model(), [{ op: 'add_comment', target: { kind: 'entity', name: 'tbl_customers', attribute: 'CustNm' }, text: 'Is this the legal name?', author: 'Ana' }]);
    const m = (r as { doc: DataModel }).doc;
    const id = m.comments![0].id;
    expect(m.comments![0].target).toEqual({ kind: 'entity', name: 'tbl_customers', attribute: 'CustNm', tab: 'main' });
    const r2 = applyOps(m, [
      { op: 'reply_comment', id, text: 'Yes — renamed it.', author: 'Claude' },
      { op: 'rename_attribute', entity: 'tbl_customers', attribute: 'CustNm', to: 'legal_name' },
      { op: 'rename_entity', entity: 'tbl_customers', to: 'customer' },
      { op: 'resolve_comment', id, resolved: true },
    ]);
    expect(r2.ok).toBe(true);
    const c = (r2 as { doc: DataModel }).doc.comments![0];
    expect(c).toMatchObject({ resolved: true, target: { name: 'customer', attribute: 'legal_name' } });
    expect(c.replies![0]).toMatchObject({ author: 'Claude', text: 'Yes — renamed it.' });
    expect(applyOps(m, [{ op: 'add_comment', target: { kind: 'model' }, text: '  ', author: 'x' }]).ok).toBe(false);
  });
});
