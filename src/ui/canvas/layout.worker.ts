// Runs dagre off the main thread for big models (a full layout of 2,000 entities takes ~0.5 s).
import { autoLayout, placeUnpositioned } from './layout';
import type { DataModel } from '../../core';
import type { Detail } from '../store';

self.onmessage = (ev: MessageEvent<{ id: number; kind: 'full' | 'place'; model: DataModel; detail: Detail; names?: string[] }>) => {
  const { id, kind, model, detail, names } = ev.data;
  const pos = kind === 'full' ? autoLayout(model, detail, names) : placeUnpositioned(model, detail);
  (self as unknown as Worker).postMessage({ id, positions: [...pos] });
};
