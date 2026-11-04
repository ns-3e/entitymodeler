// Tests run without the app's dev-server plugin (its models/ file watcher would keep the process alive).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'cli/**/*.test.ts'] },
});
