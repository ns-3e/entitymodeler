import { CircleCheck, CircleX, Info, TriangleAlert, Wand2 } from '../icons';
import { applyFixes, issueCounts, type DataModel, type Issue } from '../../core';
import { useStore } from '../store';

/** Apply the fixes of these issues to the active tab as one undo step. */
function fix(issues: Issue[]) {
  const s = useStore.getState();
  let res = { applied: 0, skipped: 0 };
  s.updateDoc((d) => void (res = applyFixes(d as DataModel, issues, s.activeTab)));
  s.toast(`Fixed ${res.applied} issue${res.applied === 1 ? '' : 's'}${res.skipped ? `; ${res.skipped} no longer applied` : ''}. ⌘Z undoes it.`, 'success');
}

const ICON = { error: CircleX, warning: TriangleAlert, info: Info };

export function IssuesView() {
  const issues = useStore((s) => s.issues);
  const { select, setView } = useStore.getState();
  const c = issueCounts(issues);
  const fixable = issues.filter((i) => i.fix?.length);
  const go = (i: Issue) => {
    const t = i.target;
    if (t.kind === 'entity' && t.name) select({ kind: 'entity', name: t.name, tab: t.tab, attribute: t.attribute });
    else if (t.kind === 'relationship' && t.name) select({ kind: 'relationship', name: t.name });
    else if (t.kind === 'hierarchy' && t.name) select({ kind: 'hierarchy', name: t.name });
    else select({ kind: 'model' });
    setView('diagram');
  };
  return (
    <div className="issues-view">
      <div className="issues-head">
        <h2>Model validation</h2>
        <span className="muted">Checked against entity, reference, relationship and hierarchy rules.</span>
        <div className="issue-counts">
          <span className="ic error">
            <CircleX size={14} /> {c.error} errors
          </span>
          <span className="ic warning">
            <TriangleAlert size={14} /> {c.warning} warnings
          </span>
          <span className="ic info">
            <Info size={14} /> {c.info} notes
          </span>
          {fixable.length > 0 && (
            <button className="btn sm primary" title="Apply every mechanical fix: naming-standard renames (they cascade) and PII flags" onClick={() => fix(fixable)}>
              <Wand2 size={14} /> Fix {fixable.length} automatically
            </button>
          )}
        </div>
      </div>
      {!issues.length && (
        <div className="issues-clean">
          <CircleCheck size={28} /> No issues found.
        </div>
      )}
      {(['error', 'warning', 'info'] as const).map((lvl) => {
        const list = issues.filter((i) => i.level === lvl);
        if (!list.length) return null;
        const Icon = ICON[lvl];
        return (
          <div key={lvl} className="issue-group">
            {list.map((i, k) => (
              <div key={k} role="button" tabIndex={0} className={`issue-item ${lvl}`} onClick={() => go(i)} onKeyDown={(e) => e.key === 'Enter' && go(i)}>
                <Icon size={16} />
                <span className="issue-msg">{i.message}</span>
                <span className="issue-code mono">{i.code}</span>
                {i.fix?.length ? (
                  <span className="issue-fixes">
                    <button
                      className="btn xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        fix([i]);
                      }}
                    >
                      Fix
                    </button>
                    {fixable.filter((x) => x.code === i.code).length > 1 && (
                      <button
                        className="btn xs ghost"
                        title={`Fix every ${i.code} issue`}
                        onClick={(e) => {
                          e.stopPropagation();
                          fix(fixable.filter((x) => x.code === i.code));
                        }}
                      >
                        All {fixable.filter((x) => x.code === i.code).length}
                      </button>
                    )}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
