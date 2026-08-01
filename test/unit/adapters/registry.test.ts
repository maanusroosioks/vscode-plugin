import { describe, expect, it } from 'vitest';
import { AdapterRegistry, NoAdapterFoundError } from '../../../src/adapters/registry';
import type { TestRunnerAdapter } from '../../../src/adapters/types';

function fakeAdapter(id: string, matches: boolean): TestRunnerAdapter {
  return {
    id,
    displayName: id,
    language: 'test',
    detect: async () => matches,
    run: async () => {
      throw new Error('not used in this test');
    },
  };
}

describe('AdapterRegistry', () => {
  it('auto-picks the single matching adapter', async () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter('a', false));
    registry.register(fakeAdapter('b', true));

    const resolved = await registry.resolveAdapter('/some/folder');
    expect(resolved.id).toBe('b');
  });

  it('throws NoAdapterFoundError when nothing matches', async () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter('a', false));

    await expect(registry.resolveAdapter('/some/folder')).rejects.toBeInstanceOf(NoAdapterFoundError);
  });

  it('delegates to pickFromMultiple when several adapters match', async () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter('a', true));
    registry.register(fakeAdapter('b', true));

    const resolved = await registry.resolveAdapter('/some/folder', {
      pickFromMultiple: async (candidates) => candidates[1],
    });
    expect(resolved.id).toBe('b');
  });

  it('honors preferredAdapterId, bypassing detection entirely', async () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter('a', false));
    registry.register(fakeAdapter('b', false));

    const resolved = await registry.resolveAdapter('/some/folder', { preferredAdapterId: 'a' });
    expect(resolved.id).toBe('a');
  });

  it('throws NoAdapterFoundError for an unregistered preferredAdapterId', async () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter('a', true));

    await expect(
      registry.resolveAdapter('/some/folder', { preferredAdapterId: 'nonexistent' }),
    ).rejects.toBeInstanceOf(NoAdapterFoundError);
  });
});
