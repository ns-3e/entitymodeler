import { create } from 'zustand';

/** App-level dialogs that canvas menus, the tab bar, shortcuts and the command palette can all open. */
interface Dialogs {
  /** New tab: optionally pre-filled from a source tab, or holding only the given entities. */
  newTab: { source?: string; kind?: 'conceptual' | 'logical' | 'physical' | 'variant'; entities?: string[] } | null;
  compare: { a?: string; b?: string; sync?: boolean } | null;
  palette: boolean;
  /** Preview of the SQL that writes descriptions back to the active tab's catalog. */
  writeback: boolean;
  /** Earlier saved versions of a workspace model. */
  history: boolean;
  open(p: Partial<Pick<Dialogs, 'newTab' | 'compare' | 'palette' | 'writeback' | 'history'>>): void;
  close(which: 'newTab' | 'compare' | 'palette' | 'writeback' | 'history'): void;
}

export const useDialogs = create<Dialogs>((set) => ({
  newTab: null,
  compare: null,
  palette: false,
  writeback: false,
  history: false,
  open: (p) => set(p),
  close: (which) => set({ [which]: which === 'palette' || which === 'writeback' || which === 'history' ? false : null } as Partial<Dialogs>),
}));
