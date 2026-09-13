import * as vscode from 'vscode';
import { resolveWorkspaceFolder } from '../core/testRunner';
import type { Logger } from '../ui/outputChannel';
import type { StatusReporter } from '../ui/statusBar';
import type { MoodleTestControl } from '../ui/testController';
import { withProgress } from '../ui/progress';
import { handleCommandError } from './errorHandling';

export function registerRunAndSubmitCommand(
  context: vscode.ExtensionContext,
  control: MoodleTestControl,
  logger: Logger,
  status: StatusReporter,
): void {
  context.subscriptions.push(
    // `target` is the clicked item when invoked from the Testing view's context
    // menu; the palette and walkthrough pass nothing.
    vscode.commands.registerCommand('moodleSubmit.runAndSubmit', async (target?: unknown) => {
      try {
        await withProgress('Moodle Submit', async (progress) => {
          const folder = control.folderFor(target) ?? (await resolveWorkspaceFolder());
          await control.performRun({
            folder,
            submit: true,
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
