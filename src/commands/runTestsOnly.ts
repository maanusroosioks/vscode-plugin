import * as vscode from 'vscode';
import type { AdapterRegistry } from '../adapters/registry';
import { resolveWorkspaceFolder, runTests, summarize } from '../core/testRunner';
import type { Logger } from '../ui/outputChannel';
import type { StatusReporter } from '../ui/statusBar';
import { withProgress } from '../ui/progress';
import { handleCommandError } from './errorHandling';

export function registerRunTestsOnlyCommand(
  context: vscode.ExtensionContext,
  registry: AdapterRegistry,
  logger: Logger,
  status: StatusReporter,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('moodleSubmit.runTestsOnly', async () => {
      try {
        await withProgress('Moodle Submit', async (progress) => {
          const folder = await resolveWorkspaceFolder();
          status.running();
          progress.report('Running tests…');
          const run = await runTests(registry, folder, { logger, signal: progress.signal });
          status.result(summarize(run));
          logger.log('Run complete (not submitted).');
        });
      } catch (error) {
        handleCommandError(error, logger, status);
      }
    }),
  );
}
