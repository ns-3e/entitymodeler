import { create } from 'zustand';

/** App-level dialogs that canvas menus, the tab bar, shortcuts and the command palette can all open. */
interface Dialogs {
  /** New tab: optionally pre-filled from a source tab, or holding only the given entities. */
  newTab: { source?: string; kind?: 'conceptual' | 'logical' | 'physical' | 'variant'; entities?: string[] } | null;
  compare: { a?: string; b?: string; sync?: boolean } | null;
  palette: boolean;
  /** Preview of the SQL that writes descriptions back to the active tab's catalog. */
  writeback: boolean;
  open(p: Partial<Pick<Dialogs, 'newTab' | 'compare' | 'palette' | 'writeback'>>): void;
  close(which: 'newTab' | 'compare' | 'palette' | 'writeback'): void;
}

export const useDialogs = create<Dialogs>((set) => ({
  newTab: null,
  compare: null,
  palette: false,
  writeback: false,
  open: (p) => set(p),
  close: (which) => set({ [which]: which === 'palette' || which === 'writeback' ? false : null } as Partial<Dialogs>),
}));
