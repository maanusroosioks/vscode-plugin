import * as vscode from 'vscode';
import type { AdapterRegistry } from '../adapters/registry';
import type { AuthService } from '../auth/authService';
import type { MoodleApiClient } from '../services/moodleApiClient';
import { buildTestRunRequest } from '../core/payload';
import { readGitCommitHash, readWorkspaceConfigFile, resolveSubmissionMetadata } from '../core/submissionMetadata';
import { resolveWorkspaceFolder, runTests, summarize } from '../core/testRunner';
import { getAssignmentKeySetting } from '../config/settings';
import type { Logger } from '../ui/outputChannel';
import type { StatusReporter } from '../ui/statusBar';
import { withProgress } from '../ui/progress';
import { ensureConfigured } from '../onboarding';
import { handleCommandError } from './errorHandling';

export function registerRunAndSubmitCommand(
  context: vscode.ExtensionContext,
  registry: AdapterRegistry,
  authService: AuthService,
  apiClient: MoodleApiClient,
  logger: Logger,
  status: StatusReporter,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('moodleSubmit.runAndSubmit', async () => {
      try {
        if (!(await ensureConfigured(context))) {
          return;
        }
        await withProgress('Moodle Submit', async (progress) => {
          const folder = await resolveWorkspaceFolder();

          progress.report('Signing in…');
          await authService.getAccessToken();

          status.running();
          progress.report('Running tests…');
          const run = await runTests(registry, folder, { logger, signal: progress.signal });

          progress.report('Resolving assignment metadata…');
          const workspaceFile = await readWorkspaceConfigFile(folder.uri.fsPath);
          const metadata = resolveSubmissionMetadata({
            workspaceFile,
            assignmentKeySetting: getAssignmentKeySetting(),
            defaultProjectName: folder.name,
            gitCommitHash: await readGitCommitHash(folder.uri.fsPath),
          });

          const payload = buildTestRunRequest(run, metadata);

          progress.report('Submitting to Moodle…');
          const response = await apiClient.submitResults(payload);
          logger.log(`Submission service responded ${response.status}: ${JSON.stringify(response.body)}`);

          const summary = summarize(run);
          status.result(summary);
          logger.log('Submitted successfully.');
          void vscode.window.showInformationMessage(
            `Submitted ${summary.total} test result(s) to Moodle (${summary.passed} passed).`,
          );
        });
      } catch (error) {
        handleCommandError(error, logger, status);
      }
    }),
  );
}
