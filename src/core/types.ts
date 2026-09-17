export type TestStatus = 'PASSED' | 'FAILED' | 'SKIPPED' | 'ERROR';

/**
 * How far the test was resolved in the project's source, independent of whether its code was
 * captured — `code` may be absent from any of these when capture is off or the budget ran out.
 * `TEST` — the declaration itself. `FILE` — only its file, carried in the run's file list.
 * `NONE` — not found at all, so there is nothing but the framework's own report.
 */
export type TestSourceKind = 'TEST' | 'FILE' | 'NONE';

export interface NormalizedTestCase {
  testSuite?: string;
  testName: string;
  status: TestStatus;
  durationMs?: number;
  message?: string;
  stackTrace?: string;
}

export interface NormalizedTestRun {
  adapterId: string;
  language: string;
  startedAt: number;
  finishedAt: number;
  results: NormalizedTestCase[];
}
