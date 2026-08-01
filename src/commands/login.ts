import * as vscode from 'vscode';
import type { AuthService } from '../auth/authService';

export function registerLoginCommand(context: vscode.ExtensionContext, authService: AuthService): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('moodleSubmit.login', async () => {
      try {
        await authService.login();
        void vscode.window.showInformationMessage('Signed in with Microsoft.');
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Sign-in failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
}
