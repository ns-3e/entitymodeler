// Who else has the open workspace model open, and what they have selected. It comes over the model's live
// connection (storage/cloud.ts) and is held only here: nothing about it is saved with the model.
import { useEffect } from 'react';
import { create } from 'zustand';
import { storage } from './storage';
import { isCloudId } from './storage/cloud';
import type { Peer } from './storage/types';
import { useStore } from './store';

const NO_ONE = new Map<string, Peer[]>();

interface Presence {
  people: Peer[];
  /** People with each entity selected, on the tab this person is looking at. */
  byEntity: Map<string, Peer[]>;
}

export const usePresence = create<Presence>(() => ({ people: [], byEntity: NO_ONE }));

function index(people: Peer[], tab: string): Map<string, Peer[]> {
  const map = new Map<string, Peer[]>();
  for (const p of people) if (p.tab === tab) for (const e of p.entities) map.set(e, [...(map.get(e) || []), p]);
  return map.size ? map : NO_ONE;
}

/** One of the --peer colors, the same for a person on every screen. */
export function peerColor(user: string): number {
  let h = 0;
  for (let i = 0; i < user.length; i++) h = (h * 31 + user.charCodeAt(i)) | 0;
  return Math.abs(h) % 3;
}

/** Follow the people on the open model, and tell them what this person has selected. */
export function usePresenceSync() {
  useEffect(() => {
    const presence = storage.presence;
    if (!presence) return;
    const off = presence.onPeople((people) => usePresence.setState({ people, byEntity: index(people, useStore.getState().activeTab) }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sent = '';
    const share = () => {
      const s = useStore.getState();
      if (!s.modelId || !isCloudId(s.modelId)) return;
      const entities = s.multi.filter((id) => id.startsWith('entity:')).map((id) => id.slice('entity:'.length));
      const key = JSON.stringify([s.modelId, s.activeTab, entities]);
      if (key === sent) return;
      sent = key;
      presence.select(s.modelId, s.activeTab, entities);
    };
    const unsub = useStore.subscribe((s, p) => {
      if (s.activeTab !== p.activeTab) usePresence.setState({ byEntity: index(usePresence.getState().people, s.activeTab) });
      if (s.multi !== p.multi || s.activeTab !== p.activeTab || s.modelId !== p.modelId) {
        clearTimeout(timer);
        timer = setTimeout(share, 300);
      }
    });
    share();
    return () => {
      off();
      unsub();
      clearTimeout(timer);
      usePresence.setState({ people: [], byEntity: NO_ONE });
    };
  }, []);
}
