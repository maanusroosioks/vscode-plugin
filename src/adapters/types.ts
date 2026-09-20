import type { NormalizedTestRun } from '../core/types';
import type { Logger } from '../core/ports';
import type { OutputSink } from '../util/shell';

export interface RunOptions {
  commandOverride?: string;
  signal?: AbortSignal;
  /** Streams the test command's output as it arrives, for live UI display. */
  onOutput?: OutputSink;
  /** Receives adapter diagnostics, not the test command's own output. */
  logger?: Logger;
}

export interface AdapterRunResult {
  run: NormalizedTestRun;
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Why the report could not be read; explains an empty `run.results`. */
  reportError?: string;
  cleanup(): Promise<void>;
}

export interface TestRunnerAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly language: string;
  detect(folderPath: string): Promise<boolean>;
  run(folderPath: string, opts: RunOptions): Promise<AdapterRunResult>;
}
