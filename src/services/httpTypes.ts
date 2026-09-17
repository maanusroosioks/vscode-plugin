import type { TestSourceKind, TestStatus } from '../core/types';

export type TestResultStatus = TestStatus;
export type { TestSourceKind };

export type Ide = 'VSCODE';

export interface TestSourceRequest {
  kind: TestSourceKind;
  /** Workspace-relative, forward slashes. Never absolute. */
  filePath?: string;
  /** 1-based, in the original file. */
  startLine?: number;
  endLine?: number;
  /** LF-normalized. May end with a truncation marker — see `normalizedCodeHash`. */
  code?: string;
  truncated?: boolean;
  /**
   * sha256 of the snippet with comments dropped and whitespace collapsed, so comparing it against
   * the previous run answers "changed, or only reformatted?" without the receiver implementing
   * language-aware normalization. Taken over the UNTRUNCATED snippet, so when `truncated` is true
   * it deliberately does not correspond to `code` — never hash `code` itself.
   */
  normalizedCodeHash?: string;
}

/**
 * Each distinct test file once. A `kind: "FILE"` result carries no `code` and is read from here
 * via `filePath`, costing one copy per file rather than one per test.
 */
export interface TestSourceFileRequest {
  /** Workspace-relative, forward slashes. Matches `TestSourceRequest.filePath`. */
  path: string;
  /** sha256 of the whole LF-normalized file, including everything outside any test body. */
  sha256: string;
  /** LF-normalized. Absent when capture is off or the per-submission budget ran out. */
  content?: string;
  truncated?: boolean;
}

export interface TestResultRequest {
  testSuite?: string;
  testName: string;
  status: TestResultStatus;
  durationMs?: number;
  message?: string;
  source?: TestSourceRequest;
}

export interface TestRunRequest {
  assignmentKey: string;
  ide: Ide;
  projectName?: string;
  commitHash?: string;
  startedAt?: number;
  finishedAt?: number;
  results: TestResultRequest[];
  testFiles?: TestSourceFileRequest[];
  /** Present only when true. Distinguishes "capture off" from "sources could not be resolved". */
  captureDisabled?: boolean;
  /** Present only when true: the pre-submit warning fired and the student submitted anyway. */
  warningAcknowledged?: boolean;
}
