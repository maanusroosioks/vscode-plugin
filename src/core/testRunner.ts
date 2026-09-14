import * as vscode from 'vscode';
import type { AdapterRegistry } from '../adapters/registry';
import type { TestRunnerAdapter } from '../adapters/types';
import type { NormalizedTestRun } from './types';
import { getPreferredAdapterId, getTestCommandOverrides } from '../config/settings';
import { MoodleSubmitError } from './errors';
import type { Logger } from '../ui/outputChannel';
import type { RunSummary } from '../ui/statusBar';
import type { OutputSink } from '../util/shell';

export class NoWorkspaceFolderError extends MoodleSubmitError {
  constructor() {
    super('Open a folder or workspace before running tests.');
  }
}

export class NoTestResultsError extends MoodleSubmitError {
  constructor(adapter: TestRunnerAdapter, exitCode: number, reportError?: string) {
    super(
      reportError
        ? `${adapter.displayName} exited with code ${exitCode} and its report could not be used: ${reportError}. ` +
            'Check the output log above for what the test command reported.'
        : `${adapter.displayName} produced no test results (exit code ${exitCode}). ` +
            'This usually means the test command itself failed to run — check the output log above for ' +
            'a missing tool (e.g. mvn/gradle/pytest/dotnet not on PATH) or a build error, rather than an actual 0-test run.',
    );
  }
}

export async function resolveWorkspaceFolder(): Promise<vscode.WorkspaceFolder> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    throw new NoWorkspaceFolderError();
  }

  const activeFolder = vscode.window.activeTextEditor
    ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    : undefined;
  if (activeFolder) {
    return activeFolder;
  }
  if (folders.length === 1) {
    return folders[0];
  }

  const pick = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { placeHolder: 'Which folder holds the tests to run?' },
  );
  if (!pick) {
    throw new NoWorkspaceFolderError();
  }
  return pick.folder;
}

async function pickAdapter(candidates: TestRunnerAdapter[]): Promise<TestRunnerAdapter> {
  const pick = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({ label: candidate.displayName, adapter: candidate })),
    { placeHolder: 'Multiple test frameworks detected — choose one' },
  );
  if (!pick) {
    throw new MoodleSubmitError('No test adapter selected.');
  }
  return pick.adapter;
}

export function summarize(run: NormalizedTestRun): RunSummary {
  return {
    total: run.results.length,
    passed: run.results.filter((r) => r.status === 'PASSED').length,
    failed: run.results.filter((r) => r.status === 'FAILED' || r.status === 'ERROR').length,
  };
}

export interface RunTestsOptions {
  logger: Logger;
  signal?: AbortSignal;
  /** Streams the test command's output as it arrives, for live UI display. */
  onOutput?: OutputSink;
}

export async function runTests(
  registry: AdapterRegistry,
  folder: vscode.WorkspaceFolder,
  { logger, signal, onOutput }: RunTestsOptions,
): Promise<NormalizedTestRun> {
  const folderPath = folder.uri.fsPath;
  const preferredAdapterId = getPreferredAdapterId();
  const adapter = await registry.resolveAdapter(folderPath, {
    preferredAdapterId,
    pickFromMultiple: pickAdapter,
  });

  // A forced adapter bypasses detection, so flag one that doesn't fit the folder.
  if (preferredAdapterId && !(await adapter.detect(folderPath))) {
    logger.log(
      `Warning: moodleSubmit.preferredAdapter forces ${adapter.displayName}, but this folder has none of ` +
        'its marker files. Clear that setting to go back to auto-detection.',
    );
  } else {
    logger.log(`Detected adapter: ${adapter.displayName}`);
  }

  const overrides = getTestCommandOverrides();
  const result = await adapter.run(folderPath, {
    commandOverride: overrides[adapter.id],
    signal,
    onOutput,
    logger,
  });

  try {
    logger.log(result.stdout);
    if (result.stderr) {
      logger.log(result.stderr);
    }

    const { run } = result;
    if (run.results.length === 0) {
      throw new NoTestResultsError(adapter, result.exitCode, result.reportError);
    }

    const summary = summarize(run);
    logger.log(
      `Parsed ${run.results.length} result(s): ${summary.passed} passed, ${summary.failed} failed/errored, ` +
        `${run.results.length - summary.passed - summary.failed} skipped.`,
    );
    return run;
  } finally {
    await result.cleanup();
  }
}
