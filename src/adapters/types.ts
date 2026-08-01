import type { NormalizedTestRun } from '../core/types';

export interface RunOptions {
  commandOverride?: string;
  signal?: AbortSignal;
}

export interface AdapterRunResult {
  run: NormalizedTestRun;
  stdout: string;
  stderr: string;
  exitCode: number;
  cleanup(): Promise<void>;
}

export interface TestRunnerAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly language: string;
  detect(folderPath: string): Promise<boolean>;
  run(folderPath: string, opts: RunOptions): Promise<AdapterRunResult>;
}
