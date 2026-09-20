import type { TestSourceKind, TestStatus } from '../core/types';

export type TestResultStatus = TestStatus;
export type { TestSourceKind };

export type Ide = 'VSCODE';

/** The test was not found in the project's source at all: only the framework's own report exists. */
export interface UnlocatedSourceRequest {
  kind: 'NONE';
}

/**
 * The file was found, but the test could not be picked out of it — the scanner knows no declarations
 * for this language, or none matched. Read the whole file from `testFiles`.
 */
export interface FileSourceRequest {
  kind: 'FILE';
  /** Workspace-relative, forward slashes. Never absolute. */
  filePath: string;
  /** Over the whole file — never comparable against a `kind: "TEST"` hash. */
  normalizedCodeHash: string;
}

export interface DeclaredSourceRequest {
  kind: 'TEST';
  /** Workspace-relative, forward slashes. Never absolute. */
  filePath: string;
  /**
   * 1-based, in the original file, and the normal way to read this test: find `filePath` in
   * `testFiles` and slice this range out of its `content`. Both are LF-normalized, so the range
   * is exact.
   */
  startLine: number;
  endLine: number;
  /**
   * LF-normalized. Fallback only: present when `testFiles` cannot supply the lines above, because
   * its `content` was dropped or was truncated before `endLine`. May end with a truncation marker
   * of its own — see `normalizedCodeHash`.
   */
  code?: string;
  truncated?: boolean;
  /**
   * sha256 of the declaration with comments dropped and whitespace collapsed, so comparing it
   * against the previous run answers "changed, or only reformatted?" without the receiver
   * implementing language-aware normalization. Taken over the UNTRUNCATED declaration, so when
   * `truncated` is true it deliberately does not correspond to `code` — never hash `code` itself.
   */
  normalizedCodeHash: string;
}

/** Discriminated on `kind`: it says which fields are present and what `normalizedCodeHash` covers. */
export type TestSourceRequest =
  | UnlocatedSourceRequest
  | FileSourceRequest
  | DeclaredSourceRequest;

/**
 * Each distinct test file once, and the source every located result is read from via `filePath`:
 * one copy per file rather than one per test, with no test's body sent twice.
 */
export interface TestSourceFileRequest {
  /** Workspace-relative, forward slashes. Matches `TestSourceRequest.filePath`. */
  path: string;
  /** sha256 of the whole LF-normalized file, including everything outside any test body. */
  sha256: string;
  /** LF-normalized. Absent when capture is off or the per-submission budget ran out. */
  content?: string;
  /** Cut at a character boundary, so line numbers still hold for what remains. */
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
