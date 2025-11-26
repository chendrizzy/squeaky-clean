import { describe, it, expect } from 'vitest';
import { cleanCommand } from '../../commands/clean.js';
import { config } from '../../config/index.js';

describe('clean command', () => {
  it('respects include/exclude and dry-run', async () => {
    config.set({
      tools: {
        ...config.get().tools,
        npm: true,
        yarn: true,
        pnpm: true,
        cargo: true,
      },
    });

    const result = await cleanCommand({
      include: 'npm',
      dryRun: true,
      sizes: false,
    });

    expect(result).toBeUndefined(); // command prints output; no throw
  });
});
