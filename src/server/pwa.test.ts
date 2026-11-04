import { describe, expect, it } from 'vitest';
import { workerSource } from './pwa';

describe('service worker', () => {
  it('generates valid JavaScript', () => {
    // A template-literal slip (e.g. a regex losing its backslashes) breaks the worker and with it offline support.
    expect(() => new Function(workerSource('test', ['/', '/assets/index.js']))).not.toThrow();
  });

  it('precaches the build and leaves the API and docs to the network', () => {
    const src = workerSource('abc123', ['/', '/assets/index.js']);
    expect(src).toContain("const CACHE = 'em-abc123'");
    expect(src).toContain('"/assets/index.js"');
    expect(src).toContain("path.startsWith('/api/')");
    expect(src).toContain("path.startsWith('/docs/')");
  });
});
