import type { TestStatus } from '../core/types';

export type TestResultStatus = TestStatus;

export type Ide = 'VSCODE';

export interface TestResultRequest {
  testSuite?: string;
  testName: string;
  status: TestResultStatus;
  durationMs?: number;
  message?: string;
  stackTraceHash?: string;
}

export interface TestRunRequest {
  assignmentKey: string;
  ide: Ide;
  projectName?: string;
  commitHash?: string;
  startedAt?: number;
  finishedAt?: number;
  results: TestResultRequest[];
}
