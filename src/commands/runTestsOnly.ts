import * as vscode from 'vscode';
import { resolveWorkspaceFolder } from '../core/testRunner';
import type { Logger } from '../ui/outputChannel';
import type { StatusReporter } from '../ui/statusBar';
import type { MoodleTestControl } from '../ui/testController';
import { withProgress } from '../ui/progress';
import { handleCommandError } from './errorHandling';

export function registerRunTestsOnlyCommand(
  context: vscode.ExtensionContext,
  control: MoodleTestControl,
  logger: Logger,
  status: StatusReporter,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('moodleSubmit.runTestsOnly', async () => {
      try {
        await withProgress('Moodle Submit', async (progress) => {
          const folder = await resolveWorkspaceFolder();
          await control.performRun({
            folder,
            submit: false,
            signal: progress.signal,
            report: progress.report,
          });
        });
      } catch (error) {
        handleCommandError(error, logger, status);
      }
    }),
  );
}
