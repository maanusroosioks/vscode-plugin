export type TestStatus = 'PASSED' | 'FAILED' | 'SKIPPED' | 'ERROR';

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
  rawReportPath?: string;
}
