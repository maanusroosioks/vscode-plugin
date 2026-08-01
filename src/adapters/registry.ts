import type { TestRunnerAdapter } from './types';
import { MoodleSubmitError } from '../core/errors';

export class NoAdapterFoundError extends MoodleSubmitError {}

export interface ResolveAdapterOptions {
  preferredAdapterId?: string;
  pickFromMultiple?: (candidates: TestRunnerAdapter[]) => Promise<TestRunnerAdapter>;
}

export class AdapterRegistry {
  private readonly adapters: TestRunnerAdapter[] = [];

  register(adapter: TestRunnerAdapter): void {
    this.adapters.push(adapter);
  }

  getAll(): TestRunnerAdapter[] {
    return [...this.adapters];
  }

  async detectAdapters(folderPath: string): Promise<TestRunnerAdapter[]> {
    const matches: TestRunnerAdapter[] = [];
    for (const adapter of this.adapters) {
      if (await adapter.detect(folderPath)) {
        matches.push(adapter);
      }
    }
    return matches;
  }

  async resolveAdapter(folderPath: string, options: ResolveAdapterOptions = {}): Promise<TestRunnerAdapter> {
    if (options.preferredAdapterId) {
      const forced = this.adapters.find((adapter) => adapter.id === options.preferredAdapterId);
      if (!forced) {
        throw new NoAdapterFoundError(
          `Preferred adapter "${options.preferredAdapterId}" is not registered.`,
        );
      }
      return forced;
    }

    const matches = await this.detectAdapters(folderPath);
    if (matches.length === 0) {
      throw new NoAdapterFoundError(`No test adapter detected for "${folderPath}".`);
    }
    if (matches.length === 1) {
      return matches[0];
    }
    if (options.pickFromMultiple) {
      return options.pickFromMultiple(matches);
    }
    return matches[0];
  }
}
