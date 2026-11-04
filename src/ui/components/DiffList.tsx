import type { TabDiff } from '../../core';

const SYM = { added: '+', removed: '−', changed: '~' } as const;

/** Entities, attributes and relationships added (+), removed (−) or changed (~); used by Compare and proposal review. */
export function DiffList({ diff }: { diff: TabDiff }) {
  return (
    <div className="diff-list">
      {!diff.entities.length && !diff.relationships.length && <div className="empty">No differences.</div>}
      {diff.entities.map((e) => (
        <div key={`e:${e.change}:${e.name}`} className={`diff-row ${e.change}`}>
          <div className="diff-head">
            <span className="diff-sym">{SYM[e.change]}</span>
            <b>{e.name}</b>
            {e.from && <span className="muted">was {e.from}</span>}
            {e.details.length > 0 && <span className="muted">· {e.details.join('; ')}</span>}
          </div>
          {e.attributes.map((x) => (
            <div key={`${x.change}:${x.name}`} className={`diff-attr ${x.change}`}>
              <span className="diff-sym">{SYM[x.change]}</span>
              <span className="mono">{x.name}</span>
              {x.from && <span className="muted mono">← {x.from}</span>}
              {x.details.length > 0 && <span className="muted">{x.details.join('; ')}</span>}
            </div>
          ))}
        </div>
      ))}
      {diff.relationships.length > 0 && <div className="menu-title">Relationships</div>}
      {diff.relationships.map((r) => (
        <div key={`r:${r.change}:${r.name}`} className={`diff-row ${r.change}`}>
          <div className="diff-head">
            <span className="diff-sym">{SYM[r.change]}</span>
            <b className="mono">{r.name}</b>
            {r.from && <span className="muted">was {r.from}</span>}
            {r.details.length > 0 && <span className="muted">· {r.details.join('; ')}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
