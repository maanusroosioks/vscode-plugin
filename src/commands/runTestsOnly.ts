import * as vscode from 'vscode';
import { resolveWorkspaceFolder } from '../ui/workspacePicker';
import type { Logger, StatusReporter } from '../core/ports';
import type { MoodleTestControl } from '../ui/testController';
import { withProgress } from '../ui/progress';
import { handleCommandError } from '../ui/errorHandling';

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
