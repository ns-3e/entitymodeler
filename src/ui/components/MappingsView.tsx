import { useMemo, useState } from 'react';
import { ArrowLeftRight, Check, Code2, Copy, Download, Wand2, X } from '../icons';
import { applyOpsInPlace, autoMap, listTabs, mappingCoverage, mappingSql, mappingsCsv, mappingsFor, tabView, typeDisplay, type DataModel, type Mapping, type Op } from '../../core';
import { useStore } from '../store';
import { downloadBlob } from '../download';
import { CommitInput, Empty, Select } from './forms';

/** Source-to-target mappings for the active tab: where each attribute comes from, and how. */
export function MappingsView() {
  const doc = useStore((s) => s.doc)!;
  const target = useStore((s) => s.activeTab);
  const toast = useStore((s) => s.toast);
  const tabs = listTabs(doc);
  const others = tabs.filter((t) => t.id !== target);
  const me = tabs.find((t) => t.id === target)!;
  const [sourcePick, setSource] = useState<string | undefined>();
  const source = sourcePick && others.some((t) => t.id === sourcePick) ? sourcePick : me.derived_from && others.some((t) => t.id === me.derived_from) ? me.derived_from : others[0]?.id;
  const T = useMemo(() => tabView(doc, target), [doc, target]);
  const S = useMemo(() => (source ? tabView(doc, source) : null), [doc, source]);
  const maps = mappingsFor(doc, target);
  const cov = mappingCoverage(doc, target);
  const [entity, setEntity] = useState<string | undefined>();
  const te = T.entities.find((e) => e.name === entity) || T.entities[0];
  const [showSql, setShowSql] = useState(false);

  const run = (ops: Op[], msg?: string) => {
    try {
      useStore.getState().updateDoc((d) => void applyOpsInPlace(d as DataModel, ops));
      if (msg) toast(msg, 'success');
    } catch (e: any) {
      toast(e.message || String(e), 'error');
    }
  };

  if (!others.length)
    return (
      <div className="mappings-view">
        <Empty title="Mappings need two tabs">Add a tab (for example, derive a logical model from a physical one), then map each target attribute to its source columns.</Empty>
      </div>
    );

  const auto = () => {
    if (!source) return;
    const found = autoMap(doc, source, target);
    if (!found.length) return toast('No new matches. Map the rest by hand.');
    useStore.getState().updateDoc((d) => void (d.mappings = [...(d.mappings || []), ...found]));
    toast(`Mapped ${found.length} attribute${found.length === 1 ? '' : 's'} by ${me.derived_from === source ? 'derivation lineage' : 'name'}. Review them below.`, 'success');
  };
  const byAttr = new Map(maps.filter((x) => x.target.entity === te?.name).map((x) => [x.target.attribute, x]));
  // The source entity this target mostly reads from, as the default for unmapped rows.
  const usual = [...byAttr.values()].flatMap((x) => x.sources).find((s) => s.tab === source)?.entity || S?.entities.find((e) => e.name === te?.derived_from || e.name === te?.name)?.name;
  const sql = showSql && te ? mappingSql(doc, target, te.name) : '';

  return (
    <div className="mappings-view">
      <div className="map-head">
        <h2>Source-to-target mappings</h2>
        <div className="map-pick">
          <span className="muted">From</span>
          <Select value={source || ''} onChange={setSource} options={others.map((t) => ({ value: t.id, label: `${t.name} (${t.kind})` }))} />
          <ArrowLeftRight size={14} className="muted" />
          <span className="muted">into</span>
          <b>{me.name}</b>
          <span className="spacer" />
          <button className="btn sm" onClick={auto} title="Match target attributes to source columns: lineage first, then names">
            <Wand2 size={14} /> Auto-map
          </button>
          <button className="btn sm" onClick={() => downloadBlob(new Blob([mappingsCsv(doc, target)], { type: 'text/csv' }), `${doc.name}-${target}-mappings.csv`)}>
            <Download size={14} /> CSV
          </button>
        </div>
        <div className="map-cov">
          <div className="map-bar">
            <i style={{ width: `${cov.pct}%` }} />
          </div>
          <span className="muted small">
            {cov.mapped} of {cov.total} attributes mapped ({cov.pct}%) · also in Tables → Source-to-target mappings
          </span>
        </div>
      </div>
      <div className="map-body">
        <div className="map-entities">
          {cov.byEntity.map((c) => (
            <button key={c.entity} className={`side-item${te?.name === c.entity ? ' active' : ''}`} onClick={() => setEntity(c.entity)}>
              <span className="side-label">{T.entities.find((e) => e.name === c.entity)?.display_name}</span>
              <span className={`side-meta${c.mapped === c.total && c.total ? ' done' : ''}`}>
                {c.mapped}/{c.total}
              </span>
            </button>
          ))}
        </div>
        {te && S && (
          <div className="map-grid-wrap">
            <div className="map-grid-head">
              <b>{te.display_name}</b>
              <span className="spacer" />
              <button className={`btn sm${showSql ? ' active' : ''}`} onClick={() => setShowSql(!showSql)}>
                <Code2 size={14} /> dbt model SQL
              </button>
            </div>
            {showSql ? (
              <div className="code-preview">
                <textarea className="input textarea mono" rows={Math.min(24, te.attributes.length + 6)} readOnly value={sql} />
                <button className="btn sm" onClick={() => navigator.clipboard.writeText(sql).then(() => toast('Copied the dbt model.', 'success'))}>
                  <Copy size={14} /> Copy
                </button>
              </div>
            ) : (
              <table className="map-grid">
                <thead>
                  <tr>
                    <th>Target attribute</th>
                    <th>Source ({S.tab?.name})</th>
                    <th>Transform</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {te.attributes.map((a) => (
                    <Row key={a.name} doc={doc} target={target} source={source!} entity={te.name} attr={a.name} type={typeDisplay(a)} mapping={byAttr.get(a.name)} usual={usual} run={run} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ doc, target, source, entity, attr, type, mapping, usual, run }: { doc: DataModel; target: string; source: string; entity: string; attr: string; type: string; mapping?: Mapping; usual?: string; run: (ops: Op[], msg?: string) => void }) {
  const S = tabView(doc, source);
  const src = mapping?.sources[0];
  const [pickEntity, setPickEntity] = useState<string | undefined>();
  const srcEntity = pickEntity || (src?.tab === source ? src.entity : undefined) || usual || S.entities[0]?.name;
  const se = S.entities.find((e) => e.name === srcEntity);
  const tgt = { tab: target, entity, attribute: attr };
  const set = (patch: Partial<Pick<Mapping, 'sources' | 'transform' | 'status'>>) =>
    run([{ op: 'set_mapping', target: tgt, sources: patch.sources ?? mapping?.sources ?? [], transform: patch.transform ?? mapping?.transform, notes: mapping?.notes, status: patch.status ?? mapping?.status }]);
  const multi = (mapping?.sources.length || 0) > 1;
  return (
    <tr className={mapping ? 'mapped' : ''}>
      <td>
        <span className="mono">{attr}</span> <span className="muted small">{type}</span>
      </td>
      <td>
        {multi ? (
          <span className="mono small">{mapping!.sources.map((s) => `${s.entity}.${s.attribute}`).join(' + ')}</span>
        ) : (
          <span className="map-src">
            <select className="input select mono" value={srcEntity || ''} onChange={(e) => setPickEntity(e.target.value)}>
              {S.entities.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.name}
                </option>
              ))}
            </select>
            <select
              className="input select mono"
              value={src?.tab === source && src.entity === srcEntity ? src.attribute || '' : ''}
              onChange={(e) => (e.target.value ? set({ sources: [{ tab: source, entity: srcEntity!, attribute: e.target.value }] }) : mapping && run([{ op: 'delete_mapping', target: tgt }]))}
            >
              <option value="">— not mapped —</option>
              {se?.attributes.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </span>
        )}
      </td>
      <td>
        <CommitInput mono value={mapping?.transform || ''} placeholder={mapping ? 'direct copy' : ''} onCommit={(v) => set({ transform: v })} />
      </td>
      <td>
        {mapping && (
          <button className={`btn xs${mapping.status === 'approved' ? ' active' : ''}`} title="Toggle approved" onClick={() => set({ status: mapping.status === 'approved' ? 'draft' : 'approved' })}>
            {mapping.status === 'approved' ? <><Check size={12} /> Approved</> : 'Draft'}
          </button>
        )}
      </td>
      <td>
        {mapping && (
          <button className="icon-btn xs" title="Remove mapping" onClick={() => run([{ op: 'delete_mapping', target: tgt }])}>
            <X size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}
