import * as vscode from 'vscode';
import type { AdapterRegistry } from '../adapters/registry';
import type { TestRunnerAdapter } from '../adapters/types';
import type { NormalizedTestRun } from './types';
import { getPreferredAdapterId, getTestCommandOverrides } from '../config/settings';
import { MoodleSubmitError } from './errors';
import type { Logger } from '../ui/outputChannel';
import type { RunSummary } from '../ui/statusBar';

export class NoWorkspaceFolderError extends MoodleSubmitError {
  constructor() {
    super('Open a folder or workspace before running tests.');
  }
}

export class NoTestResultsError extends MoodleSubmitError {
  constructor(adapter: TestRunnerAdapter, exitCode: number) {
    super(
      `${adapter.displayName} produced no test results (exit code ${exitCode}). ` +
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
}

export async function runTests(
  registry: AdapterRegistry,
  folder: vscode.WorkspaceFolder,
  { logger, signal }: RunTestsOptions,
): Promise<NormalizedTestRun> {
  const adapter = await registry.resolveAdapter(folder.uri.fsPath, {
    preferredAdapterId: getPreferredAdapterId(),
    pickFromMultiple: pickAdapter,
  });

  logger.log(`Detected adapter: ${adapter.displayName}`);

  const overrides = getTestCommandOverrides();
  const result = await adapter.run(folder.uri.fsPath, {
    commandOverride: overrides[adapter.id],
    signal,
  });

  try {
    logger.log(result.stdout);
    if (result.stderr) {
      logger.log(result.stderr);
    }

    const { run } = result;
    if (run.results.length === 0) {
      throw new NoTestResultsError(adapter, result.exitCode);
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
