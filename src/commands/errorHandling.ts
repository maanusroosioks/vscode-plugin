import * as vscode from 'vscode';
import { CancelledError, MoodleSubmitError } from '../core/errors';
import type { Logger } from '../ui/outputChannel';
import type { StatusReporter } from '../ui/statusBar';

export function describeError(error: unknown): string {
  if (error instanceof MoodleSubmitError) return error.userMessage;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function handleCommandError(error: unknown, logger: Logger, status: StatusReporter): void {
  if (error instanceof CancelledError) {
    logger.log(error.message);
    status.idle();
    return;
  }

  const message = describeError(error);
  logger.log(`Error: ${message}`);
  status.error(message);
  void vscode.window.showErrorMessage(message, 'Show Output').then((choice) => {
    if (choice === 'Show Output') {
      void vscode.commands.executeCommand('moodleSubmit.showOutput');
    }
  });
}
