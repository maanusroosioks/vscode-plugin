import type { NormalizedTestRun } from './types';
import type { SubmissionMetadata } from './submissionMetadata';
import type { TestEvidencePayload, TestSource, TestSourceFile } from './testEvidence';
import type {
  TestResultRequest,
  TestRunRequest,
  TestSourceFileRequest,
  TestSourceRequest,
} from '../services/httpTypes';
import { sha256Hex } from './stackTraceHash';
import { MoodleSubmitError } from './errors';

export class InvalidPayloadError extends MoodleSubmitError {
  get userMessage(): string {
    return `Invalid submission: ${this.message}`;
  }
}

const MAX_255 = 255;
const MAX_100 = 100;

function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}


function sanitizeForParamText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.replace(/[<>]/g, '');
}

function textField(value: string | undefined, max: number): string | undefined {
  return truncate(sanitizeForParamText(value), max);
}

function toSourceRequest(source: TestSource): TestSourceRequest {
  return {
    kind: source.kind,
    filePath: truncate(source.filePath, MAX_255),
    startLine: source.startLine,
    endLine: source.endLine,
    code: source.code,
    truncated: source.truncated,
    normalizedCodeHash: source.normalizedCodeHash,
  };
}

function toSourceFileRequest(file: TestSourceFile): TestSourceFileRequest {
  return {
    path: truncate(file.path, MAX_255) as string,
    sha256: file.sha256,
    content: file.content,
    truncated: file.truncated,
  };
}

export function buildTestRunRequest(
  run: NormalizedTestRun,
  metadata: SubmissionMetadata,
  evidence?: TestEvidencePayload,
): TestRunRequest {
  if (run.results.length === 0) {
    throw new InvalidPayloadError('Test run produced no results — nothing to submit.');
  }
  if (!metadata.assignmentKey.trim()) {
    throw new InvalidPayloadError('assignmentKey must not be blank.');
  }

  const results: TestResultRequest[] = run.results.map((testCase, index): TestResultRequest => {
    if (!testCase.testName.trim()) {
      throw new InvalidPayloadError('Encountered a test result with a blank testName.');
    }
    const source = evidence?.sources[index];
    return {
      testSuite: textField(testCase.testSuite, MAX_255),
      testName: textField(testCase.testName, MAX_255) as string,
      status: testCase.status,
      durationMs: testCase.durationMs !== undefined ? Math.max(0, testCase.durationMs) : undefined,
      message: sanitizeForParamText(testCase.message),
      stackTraceHash: testCase.stackTrace ? sha256Hex(testCase.stackTrace) : undefined,
      source: source ? toSourceRequest(source) : undefined,
    };
  });

  return {
    assignmentKey: truncate(metadata.assignmentKey, MAX_100) as string,
    ide: 'VSCODE',
    projectName: truncate(metadata.projectName, MAX_255),
    commitHash: truncate(metadata.commitHash, MAX_100),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    results,
    testFiles: evidence && evidence.files.length > 0 ? evidence.files.map(toSourceFileRequest) : undefined,
    captureDisabled: evidence?.captureDisabled,
    warningAcknowledged: evidence?.warningAcknowledged,
  };
}
