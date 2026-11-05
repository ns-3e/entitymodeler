import { listTabs } from '../../core';
import { peerColor, usePresence } from '../presence';
import { useStore } from '../store';

const SHOWN = 4;
const initial = (name: string) => (name.trim()[0] || '?').toUpperCase();

/** The other people with this workspace model open. Hidden on phones, where the top bar has no room. */
export function PresenceBar() {
  const people = usePresence((s) => s.people);
  const doc = useStore((s) => s.doc);
  if (!people.length || !doc) return null;
  const tabs = listTabs(doc);
  const describe = (p: (typeof people)[number]) => {
    const tab = tabs.find((t) => t.id === p.tab)?.name;
    const picked = p.entities.length ? `, selected ${p.entities.join(', ')}` : '';
    return `${p.name}${tab ? `: on ${tab}${picked}` : ''}`;
  };
  const rest = people.slice(SHOWN);
  return (
    <ul className="presence tb-wide" aria-label="Also on this model">
      {people.slice(0, SHOWN).map((p) => (
        <li key={p.user} className={`peer-${peerColor(p.user)}`} title={describe(p)} aria-label={describe(p)}>
          {initial(p.name)}
        </li>
      ))}
      {rest.length > 0 && (
        <li title={rest.map(describe).join('\n')} aria-label={rest.map(describe).join('. ')}>
          +{rest.length}
        </li>
      )}
    </ul>
  );
}
