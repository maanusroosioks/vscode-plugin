import { describe, expect, it } from 'vitest';
import { defineAdapter, type PreparedRun } from '../../../src/adapters/define';
import { CancelledError } from '../../../src/core/errors';

const NOOP_COMMAND = 'node --version';

function adapterThatPrepares(prepared: Partial<PreparedRun>) {
  return defineAdapter({
    id: 'fake',
    displayName: 'Fake Runner',
    language: 'fictional',
    detect: async () => true,
    prepare: async () => ({
      command: NOOP_COMMAND,
      parse: async () => [],
      ...prepared,
    }),
  });
}

describe('defineAdapter', () => {
  it('stamps the run with the adapter id and language from the spec', async () => {
    const adapter = adapterThatPrepares({
      parse: async () => [{ testName: 'works', status: 'PASSED' as const }],
    });

    const result = await adapter.run(process.cwd(), {});

    expect(result.run.adapterId).toBe('fake');
    expect(result.run.language).toBe('fictional');
    expect(result.run.results).toHaveLength(1);
    expect(result.reportError).toBeUndefined();
    expect(result.run.finishedAt).toBeGreaterThanOrEqual(result.run.startedAt);
  });

  it('reports an unreadable report instead of passing off empty results as a clean run', async () => {
    const logged: string[] = [];
    const adapter = adapterThatPrepares({
      parse: async () => {
        throw new Error('no report was written to /tmp/nope.xml');
      },
    });

    const result = await adapter.run(process.cwd(), { logger: { log: (m) => logged.push(m) } });

    expect(result.run.results).toEqual([]);
    expect(result.reportError).toContain('no report was written');
    expect(logged.join('\n')).toContain('Fake Runner');
  });

  it('gives parse the timestamp taken before the command started', async () => {
    let seen = 0;
    const before = Date.now();
    const adapter = adapterThatPrepares({
      parse: async (startedAt) => {
        seen = startedAt;
        return [];
      },
    });

    const result = await adapter.run(process.cwd(), {});

    expect(seen).toBeGreaterThanOrEqual(before);
    expect(seen).toBe(result.run.startedAt);
  });

  it('cleans up when the run is cancelled', async () => {
    let cleaned = 0;
    const adapter = adapterThatPrepares({ cleanup: async () => void (cleaned += 1) });

    await expect(
      adapter.run(process.cwd(), { signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(cleaned).toBe(1);
  });

  it('hands cleanup back to the caller on the success path rather than running it early', async () => {
    let cleaned = 0;
    const adapter = adapterThatPrepares({ cleanup: async () => void (cleaned += 1) });

    const result = await adapter.run(process.cwd(), {});
    expect(cleaned).toBe(0);

    await result.cleanup();
    expect(cleaned).toBe(1);
  });
});
