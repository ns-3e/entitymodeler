import { STANDARD_PRESETS, MAX_IDENTIFIER, TAB_KINDS, type NamingStandard, type TabKind } from '../../core';
import { useStore } from '../store';
import { Field, NumberInput, Segmented, Select, TextInput, Toggle } from '../components/forms';

/** Naming standards for each kind of tab, in the model inspector. Off until switched on; presets fill sensible rules. */
export function StandardsSection() {
  const model = useStore((s) => s.model)!;
  const doc = useStore((s) => s.doc)!;
  const updateDoc = useStore((s) => s.updateDoc);
  const kind: TabKind = model.tab?.kind || 'logical';
  const std = doc.standards?.[kind];
  const set = (patch: Partial<NamingStandard> | null) =>
    updateDoc((d) => {
      d.standards = { ...(d.standards || {}) };
      if (patch === null) delete d.standards[kind];
      else d.standards[kind] = { ...(d.standards[kind] || {}), ...patch };
      for (const k of Object.keys(patch || {}) as (keyof NamingStandard)[]) if (patch![k] === undefined || patch![k] === '') delete d.standards[kind]![k];
      if (!Object.keys(d.standards).length) delete d.standards;
    });
  const label = TAB_KINDS.find((k) => k.id === kind)!.label.toLowerCase();

  return (
    <div className="stack">
      <div className="section-title">
        <span>Naming standards · {label} tabs</span>
      </div>
      <Toggle
        checked={!!std}
        onChange={(on) => set(on ? { ...STANDARD_PRESETS[kind], ...(kind === 'physical' && model.tab?.dialect ? { max_length: MAX_IDENTIFIER[model.tab.dialect] } : {}) } : null)}
        label={`Check ${label} tabs against standards`}
      />
      {std && (
        <>
          <div className="grid2">
            <Field label="Attribute case">
              <Select value={std.attribute_case || ''} onChange={(v) => set({ attribute_case: (v || undefined) as NamingStandard['attribute_case'] })} options={[{ value: '', label: 'Any' }, { value: 'snake', label: 'snake_case' }, { value: 'camel', label: 'camelCase' }, { value: 'upper_snake', label: 'UPPER_SNAKE' }]} />
            </Field>
            <Field label="Entity names">
              <Segmented size="sm" value={std.entity_number || ''} onChange={(v) => set({ entity_number: (v || undefined) as NamingStandard['entity_number'] })} options={[{ value: '', label: 'Any' }, { value: 'singular', label: 'Singular' }, { value: 'plural', label: 'Plural' }]} />
            </Field>
          </div>
          <div className="grid2">
            <Field label="Entity prefix">
              <TextInput mono value={std.entity_prefix} onChange={(v) => set({ entity_prefix: v })} placeholder="none" />
            </Field>
            <Field label="Reference prefix">
              <TextInput mono value={std.reference_prefix} onChange={(v) => set({ reference_prefix: v })} placeholder="ref_" />
            </Field>
          </div>
          <div className="grid2">
            <Field label="Key suffix">
              <TextInput mono value={std.pk_suffix} onChange={(v) => set({ pk_suffix: v })} placeholder="_id" />
            </Field>
            <Field label="Max name length">
              <NumberInput step={1} min={8} value={std.max_length} onChange={(v) => set({ max_length: v || undefined })} />
            </Field>
          </div>
          <Toggle checked={std.abbreviations === 'expand'} onChange={(v) => set({ abbreviations: v ? 'expand' : undefined })} label="Spell out abbreviations (cust → customer)" />
          <Toggle checked={std.require_entity_description} onChange={(v) => set({ require_entity_description: v || undefined })} label="Entities need a description" />
          <Toggle checked={std.require_attribute_description} onChange={(v) => set({ require_attribute_description: v || undefined })} label="Attributes need a description" />
          <Toggle checked={std.require_pii_review} onChange={(v) => set({ require_pii_review: v || undefined })} label="Flag personal-data columns not marked PII" />
          <p className="muted small">Findings appear in Issues; renames and PII flags can be fixed in one click. Each tab kind has its own standards.</p>
        </>
      )}
    </div>
  );
}
