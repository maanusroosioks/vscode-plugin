import * as vscode from 'vscode';
import { getOutputChannel } from '../ui/outputChannel';

export function registerShowOutputCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('moodleSubmit.showOutput', () => {
      getOutputChannel().show();
    }),
  );
}
