// Font assets for the PDF export, fetched only when a PDF is built.
import type { PdfAssets } from '../core/pdf';
import regular from '../core/assets/SchibstedGrotesk-Regular.ttf?url';
import semibold from '../core/assets/SchibstedGrotesk-SemiBold.ttf?url';
import display from '../core/assets/DMSerifDisplay-Regular.ttf?url';
import mono from '../core/assets/IBMPlexMono-Regular.ttf?url';

const URLS: Record<keyof PdfAssets, string> = { regular, semibold, display, mono };
let cache: Promise<PdfAssets> | undefined;

export function loadPdfAssets(): Promise<PdfAssets> {
  cache ??= Promise.all(
    Object.entries(URLS).map(async ([k, url]) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Could not load ${url}`);
      return [k, new Uint8Array(await r.arrayBuffer())] as const;
    }),
  ).then(Object.fromEntries);
  cache.catch(() => (cache = undefined));
  return cache;
}
