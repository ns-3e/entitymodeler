import { useCallback } from 'react';
import { BookMarked, Copy, Database, Trash2 } from '../icons';
import { deleteEntity, renameEntity, toInternalName, uniqueName, type DataModel, type Entity } from '../../core';
import { useStore } from '../store';
import { CommitInput } from '../components/forms';
import { GeneralTab } from './GeneralTab';
import { AttributesTab } from './AttributesTab';
import { StructsTab } from './StructsTab';
import { ValuesTab } from './ValuesTab';
import { CommentsSection } from '../components/Comments';

export type EntityUpdater = (fn: (e: Entity, m: DataModel) => void, coalesceKey?: string) => void;

export function useEntityUpdate(name: string): EntityUpdater {
  const update = useStore((s) => s.update);
  return useCallback(
    (fn, key) =>
      update((m) => {
        const e = m.entities.find((x) => x.name === name);
        if (e) fn(e, m);
      }, key && `${name}:${key}`),
    [name, update],
  );
}

const TABS: { id: string; label: string; reference?: boolean }[] = [
  { id: 'general', label: 'General' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'values', label: 'Values', reference: true },
  { id: 'structs', label: 'Structs' },
];

export function EntityInspector({ entity, tab, attribute }: { entity: Entity; tab?: string; attribute?: string }) {
  const model = useStore((s) => s.model)!;
  const issues = useStore((s) => s.issues);
  const { select, update } = useStore.getState();
  const upd = useEntityUpdate(entity.name);
  const tabs = TABS.filter((t) => !t.reference || entity.entity_type === 'reference');
  const active = tabs.some((t) => t.id === tab) ? tab! : 'attributes';
  const tabIssues = (id: string) => issues.filter((i) => i.target.kind === 'entity' && i.target.name === entity.name && i.target.tab === id && i.level !== 'info');
  const Icon = entity.entity_type === 'reference' ? BookMarked : Database;

  const duplicate = () => {
    let name = '';
    update((m) => {
      const copy: Entity = JSON.parse(JSON.stringify(entity));
      copy.name = uniqueName(`${entity.name}_copy`, m.entities.map((e) => e.name));
      copy.display_name = `${entity.display_name} Copy`;
      copy.ui = entity.ui ? { x: entity.ui.x + 40, y: entity.ui.y + 40 } : undefined;
      m.entities.push(copy);
      name = copy.name;
    });
    select({ kind: 'entity', name });
  };
  const remove = () => {
    if (!window.confirm(`Delete entity "${entity.display_name}"? Relationships and reference links to it are removed too.`)) return;
    update((m) => deleteEntity(m, entity.name));
    select({ kind: 'model' });
  };

  return (
    <div className="inspector-entity" style={{ ['--entity-color' as any]: entity.color_code }}>
      <div className="insp-head">
        <div className="insp-icon">
          <Icon size={18} />
        </div>
        <div className="insp-titles">
          <CommitInput
            className="insp-title-input"
            value={entity.display_name}
            onCommit={(v) =>
              upd((e) => {
                e.display_name = v;
              })
            }
            validate={(v) => (v.trim() ? null : 'Required')}
          />
          <div className="insp-sub">
            <CommitInput
              mono
              className="insp-name-input"
              value={entity.name}
              transform={toInternalName}
              validate={(v) => (!v ? 'Required' : model.entities.some((e) => e.name === v) ? 'Name in use' : null)}
              onCommit={(v) => {
                update((m) => renameEntity(m, entity.name, v));
                select({ kind: 'entity', name: v, tab: active });
              }}
            />
            <span className={`pill pill-${entity.entity_type}`}>{entity.entity_type === 'reference' ? 'reference' : 'entity'}</span>
          </div>
        </div>
        <div className="insp-actions">
          <button className="icon-btn" title="Duplicate" onClick={duplicate}>
            <Copy size={16} />
          </button>
          <button className="icon-btn danger" title="Delete entity" onClick={remove}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="tabs">
        {tabs.map((t) => {
          const n = tabIssues(t.id);
          return (
            <button key={t.id} className={`tab${t.id === active ? ' active' : ''}`} onClick={() => select({ kind: 'entity', name: entity.name, tab: t.id })}>
              {t.label}
              {t.id === 'values' && !!entity.reference_values?.length && <span className="tab-count">{entity.reference_values.length}</span>}
              {n.length > 0 && <span className={`tab-dot ${n.some((i) => i.level === 'error') ? 'error' : 'warning'}`} />}
            </button>
          );
        })}
      </div>
      <div className="insp-body">
        {active === 'general' && <GeneralTab entity={entity} upd={upd} />}
        {active === 'attributes' && <AttributesTab entity={entity} upd={upd} focus={attribute} />}
        {active === 'values' && <ValuesTab entity={entity} upd={upd} />}
        {active === 'structs' && <StructsTab entity={entity} upd={upd} />}
        <TabIssues issues={tabIssues(active)} />
        <CommentsSection target={{ kind: 'entity', name: entity.name }} includeAttributes />
      </div>
    </div>
  );
}

function TabIssues({ issues }: { issues: { level: string; message: string }[] }) {
  if (!issues.length) return null;
  return (
    <div className="tab-issues">
      {issues.map((i, k) => (
        <div key={k} className={`issue-line ${i.level}`}>
          {i.message}
        </div>
      ))}
    </div>
  );
}
