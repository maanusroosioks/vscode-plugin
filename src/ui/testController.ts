import * as vscode from 'vscode';
import type { AdapterRegistry } from '../adapters/registry';
import type { AuthService } from '../auth/authService';
import {
  getAssignmentKeySetting,
  getSourceCaptureSettings,
  getWarnOnSuspiciousTests,
} from '../config/settings';
import { TestLocationResolver } from '../capture/location';
import {
  collectTestEvidence,
  describeSuspiciousTests,
  type TestEvidence,
} from '../capture/evidence';
import {
  folderItemId,
  suiteDescription,
  suiteItemId,
  suiteKey,
  suiteLabel,
  testItemId,
  type KnownTest,
} from './testTree';
import { runTests, summarize } from '../core/testRunner';
import { pickAdapter, resolveWorkspaceFolder } from './workspacePicker';
import { submitRun } from '../core/submitRun';
import type { NormalizedTestCase, NormalizedTestRun } from '../core/types';
import { describeError, handleCommandError } from './errorHandling';
import { ensureConfigured } from './onboarding';
import type { MoodleApiClient } from '../services/moodleApiClient';
import { confirmDegradedRun, describeFinding } from './degradedRunPrompt';
import type { Logger, StatusReporter } from '../core/ports';

const KNOWN_TESTS_KEY = 'moodleSubmit.knownTests';

export interface TestControllerDeps {
  registry: AdapterRegistry;
  authService: AuthService;
  apiClient: MoodleApiClient;
  logger: Logger;
  status: StatusReporter;
}

export interface PerformRunOptions {
  folder: vscode.WorkspaceFolder;
  submit: boolean;
  request?: vscode.TestRunRequest;
  signal?: AbortSignal;
  report?: (message: string) => void;
}

export interface MoodleTestControl {
  performRun(options: PerformRunOptions): Promise<void>;
  folderFor(target: unknown): vscode.WorkspaceFolder | undefined;
}

function asTestItem(target: unknown): vscode.TestItem | undefined {
  if (typeof target !== 'object' || target === null) return undefined;
  const candidate = target as Partial<vscode.TestItem>;
  return typeof candidate.id === 'string' && candidate.children !== undefined
    ? (candidate as vscode.TestItem)
    : undefined;
}

/** The Testing terminal renders raw bytes, so bare LF would stair-step. */
function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

/** Snapshots ids so the collection can be mutated while walking it. */
function idsOf(collection: vscode.TestItemCollection): string[] {
  const ids: string[] = [];
  collection.forEach((item) => ids.push(item.id));
  return ids;
}

function failureMessage(testCase: NormalizedTestCase): string {
  const parts = [testCase.message, testCase.stackTrace].filter(
    (part): part is string => !!part && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join('\n\n') : `${testCase.status} with no reported message.`;
}

export function registerTestController(
  context: vscode.ExtensionContext,
  deps: TestControllerDeps,
): MoodleTestControl {
  const controller = vscode.tests.createTestController('moodleSubmit.tests', 'Moodle Tests');
  context.subscriptions.push(controller);

  // ---------------------------------------------------------------- tree ----

  function folderItem(folder: vscode.WorkspaceFolder): vscode.TestItem {
    const id = folderItemId(folder.uri.fsPath);
    const existing = controller.items.get(id);
    if (existing) return existing;

    const item = controller.createTestItem(id, folder.name, folder.uri);
    item.description = 'run to discover tests';
    controller.items.add(item);
    return item;
  }

  function childItem(
    parent: vscode.TestItem,
    id: string,
    label: string,
    uri: vscode.Uri | undefined,
  ): vscode.TestItem {
    const existing = parent.children.get(id);
    // `TestItem.uri` is readonly, so an item whose file moved must be recreated.
    if (existing && existing.uri?.toString() === uri?.toString()) {
      existing.label = label;
      return existing;
    }
    if (existing) {
      parent.children.delete(id);
    }
    const item = controller.createTestItem(id, label, uri);
    parent.children.add(item);
    return item;
  }

  function knownTests(): Record<string, KnownTest[]> {
    return context.workspaceState.get<Record<string, KnownTest[]>>(KNOWN_TESTS_KEY) ?? {};
  }

  async function rememberTests(folderPath: string, tests: KnownTest[]): Promise<void> {
    await context.workspaceState.update(KNOWN_TESTS_KEY, { ...knownTests(), [folderPath]: tests });
  }

  function restoreFolder(folder: vscode.WorkspaceFolder): void {
    const root = folderItem(folder);
    const remembered = knownTests()[folder.uri.fsPath] ?? [];
    if (remembered.length === 0) return;

    // Grouped by suite first — recreating a suite item mid-loop would drop
    // siblings already added under it.
    const bySuite = new Map<string, KnownTest[]>();
    for (const test of remembered) {
      bySuite.set(test.suite, [...(bySuite.get(test.suite) ?? []), test]);
    }

    for (const [suite, tests] of bySuite) {
      const suiteFile = tests.find((test) => test.file)?.file;
      const suiteItem = childItem(
        root,
        suiteItemId(folder.uri.fsPath, suite),
        suiteLabel(suite),
        suiteFile ? vscode.Uri.file(suiteFile) : undefined,
      );
      suiteItem.description = suiteDescription(suite);
      for (const test of tests) {
        childItem(
          suiteItem,
          testItemId(folder.uri.fsPath, suite, test.name),
          test.name,
          test.file ? vscode.Uri.file(test.file) : undefined,
        );
      }
    }
    root.description = undefined;
  }

  function syncFolders(): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const live = new Set(folders.map((folder) => folderItemId(folder.uri.fsPath)));
    for (const id of idsOf(controller.items)) {
      if (!live.has(id)) {
        controller.items.delete(id);
      }
    }
    for (const folder of folders) {
      restoreFolder(folder);
    }
  }

  syncFolders();
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(syncFolders));

  function folderOf(item: vscode.TestItem): vscode.WorkspaceFolder | undefined {
    let root = item;
    while (root.parent) {
      root = root.parent;
    }
    return (vscode.workspace.workspaceFolders ?? []).find(
      (folder) => folderItemId(folder.uri.fsPath) === root.id,
    );
  }

  // ------------------------------------------------------------- results ----

  async function applyResults(
    testRun: vscode.TestRun,
    folder: vscode.WorkspaceFolder,
    run: NormalizedTestRun,
    resolver: TestLocationResolver,
  ): Promise<void> {
    const folderPath = folder.uri.fsPath;
    const root = folderItem(folder);
    const remembered: KnownTest[] = [];
    const liveSuites = new Set<string>();
    const liveTests = new Map<string, Set<string>>();

    for (const testCase of run.results) {
      const suite = suiteKey(testCase.testSuite);
      const location = await resolver.resolveTestLocation(testCase.testSuite, testCase.stackTrace);
      const suiteFile = await resolver.resolveSuiteFile(testCase.testSuite);

      const suiteId = suiteItemId(folderPath, suite);
      const suiteItem = childItem(
        root,
        suiteId,
        suiteLabel(suite),
        suiteFile ? vscode.Uri.file(suiteFile) : undefined,
      );
      suiteItem.description = suiteDescription(suite);
      liveSuites.add(suiteId);

      const testId = testItemId(folderPath, suite, testCase.testName);
      const item = childItem(
        suiteItem,
        testId,
        testCase.testName,
        location ? vscode.Uri.file(location.file) : undefined,
      );
      if (location?.line !== undefined) {
        const line = Math.max(0, location.line - 1);
        item.range = new vscode.Range(line, 0, line, 0);
      }
      liveTests.set(suiteId, (liveTests.get(suiteId) ?? new Set()).add(testId));
      remembered.push({ suite, name: testCase.testName, file: location?.file });

      testRun.started(item);
      reportResult(testRun, item, testCase, location);
    }

    for (const suiteId of idsOf(root.children)) {
      const suiteItem = root.children.get(suiteId);
      if (!suiteItem) continue;
      if (!liveSuites.has(suiteId)) {
        root.children.delete(suiteId);
        continue;
      }
      const kept = liveTests.get(suiteId) ?? new Set<string>();
      for (const testId of idsOf(suiteItem.children)) {
        if (!kept.has(testId)) {
          suiteItem.children.delete(testId);
        }
      }
    }

    root.description = undefined;
    await rememberTests(folderPath, remembered);
  }

  function reportResult(
    testRun: vscode.TestRun,
    item: vscode.TestItem,
    testCase: NormalizedTestCase,
    location: { file: string; line?: number } | undefined,
  ): void {
    switch (testCase.status) {
      case 'PASSED':
        testRun.passed(item, testCase.durationMs);
        return;
      case 'SKIPPED':
        testRun.skipped(item);
        return;
      default: {
        const message = new vscode.TestMessage(failureMessage(testCase));
        if (location?.line !== undefined) {
          const line = Math.max(0, location.line - 1);
          message.location = new vscode.Location(
            vscode.Uri.file(location.file),
            new vscode.Range(line, 0, line, 0),
          );
        }
        if (testCase.status === 'FAILED') {
          testRun.failed(item, message, testCase.durationMs);
        } else {
          testRun.errored(item, message, testCase.durationMs);
        }
      }
    }
  }

  // ------------------------------------------------------------ evidence ----

  async function gatherEvidence(
    run: NormalizedTestRun,
    folder: vscode.WorkspaceFolder,
    resolver: TestLocationResolver,
  ): Promise<TestEvidence | undefined> {
    try {
      const evidence = await collectTestEvidence(run, resolver, {
        folderPath: folder.uri.fsPath,
        ...getSourceCaptureSettings(),
      });
      const { sources, files } = evidence.payload;
      let located = 0;
      // Snippets are the fallback for lines their file could not carry, so counting them as the
      // captured total would read as a failure on the normal path, where every file went whole.
      let snippets = 0;
      let chars = 0;
      for (const source of sources) {
        if (source.kind !== 'TEST') continue;
        located++;
        if (source.code === undefined) continue;
        snippets++;
        chars += source.code.length;
      }
      const fileChars = files.reduce((total, file) => total + (file.content?.length ?? 0), 0);
      const fallback = snippets > 0 ? `, plus ${snippets} snippet(s) (${chars} chars)` : '';
      deps.logger.log(
        `Located ${located}/${run.results.length} tests in ${files.length} file(s) ` +
          `(${fileChars} chars)${fallback}.`,
      );
      return evidence;
    } catch (error) {
      // Capturing source must never be able to break a submission.
      deps.logger.log(`Could not capture test source: ${describeError(error)}`);
      return undefined;
    }
  }

  // ----------------------------------------------------------------- run ----

  async function performRun({
    folder,
    submit,
    request,
    signal,
    report,
  }: PerformRunOptions): Promise<void> {
    if (submit && !(await ensureConfigured(context))) {
      return;
    }

    const testRun = controller.createTestRun(
      request ?? new vscode.TestRunRequest(),
      submit ? 'Run & Submit to Moodle' : 'Run Tests',
      true,
    );
    const controllerAbort = new AbortController();
    const onAbort = (): void => controllerAbort.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controllerAbort.abort();
    const cancelSub = testRun.token.onCancellationRequested(onAbort);

    try {
      if (submit) {
        report?.('Signing in…');
        await deps.authService.getAccessToken();
      }

      deps.status.running();
      report?.('Running tests…');
      const run = await runTests(deps.registry, folder.uri.fsPath, {
        logger: deps.logger,
        signal: controllerAbort.signal,
        onOutput: (chunk) => testRun.appendOutput(toCrlf(chunk)),
        pickFromMultiple: pickAdapter,
      });

      // One resolver for the whole run: its probe cache is what makes the second pass over the
      // results, for source capture, cost no extra filesystem work.
      const resolver = new TestLocationResolver(folder.uri.fsPath, run.language);
      await applyResults(testRun, folder, run, resolver);
      const summary = summarize(run);
      deps.status.result(summary);

      if (!submit) {
        deps.logger.log('Run complete (not submitted).');
        return;
      }

      const evidence = await gatherEvidence(run, folder, resolver);
      let evidencePayload = evidence?.payload;
      if (evidence) {
        const findings = describeSuspiciousTests(evidence.integrity);
        for (const finding of findings) {
          deps.logger.log(`Integrity warning: ${describeFinding(finding)}`);
        }
        if (findings.length > 0 && getWarnOnSuspiciousTests()) {
          if (!(await confirmDegradedRun(findings, run.results.length))) {
            deps.logger.log('Submission cancelled at the integrity warning.');
            testRun.appendOutput(toCrlf('\nSubmission cancelled.\n'));
            return;
          }
          evidencePayload = { ...evidence.payload, warningAcknowledged: true };
        }
      }

      report?.('Submitting to Moodle…');
      await submitRun(
        run,
        {
          folderPath: folder.uri.fsPath,
          projectName: folder.name,
          assignmentKeySetting: getAssignmentKeySetting(),
          evidence: evidencePayload,
        },
        { apiClient: deps.apiClient, logger: deps.logger },
      );
      deps.logger.log('Submitted successfully.');
      testRun.appendOutput(toCrlf(`\nSubmitted ${summary.total} test result(s) to Moodle.\n`));
      void vscode.window.showInformationMessage(
        `Submitted ${summary.total} test result(s) to Moodle (${summary.passed} passed).`,
      );
    } catch (error) {
      testRun.appendOutput(toCrlf(`\n${describeError(error)}\n`));
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      cancelSub.dispose();
      testRun.end();
    }
  }

  // ------------------------------------------------------------- profile ----

  // Only one profile — submitting is the separate runAndSubmit command
  // (toolbar button + context menu), not a second profile to switch between.
  const runHandler = async (
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<void> => {
    const abort = new AbortController();
    const sub = token.onCancellationRequested(() => abort.abort());
    try {
      await performRun({
        folder: await folderForRequest(request),
        submit: false,
        request,
        signal: abort.signal,
      });
    } catch (error) {
      handleCommandError(error, deps.logger, deps.status);
    } finally {
      sub.dispose();
    }
  };

  controller.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, runHandler, true);

  async function folderForRequest(request: vscode.TestRunRequest): Promise<vscode.WorkspaceFolder> {
    const included = request.include?.length ? folderOf(request.include[0]) : undefined;
    return included ?? resolveWorkspaceFolder();
  }

  function folderFor(target: unknown): vscode.WorkspaceFolder | undefined {
    const item = asTestItem(target);
    return item ? folderOf(item) : undefined;
  }

  return { performRun, folderFor };
}
