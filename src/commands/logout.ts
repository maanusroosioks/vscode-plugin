import * as vscode from 'vscode';
import type { AuthService } from '../auth/authService';

export function registerLogoutCommand(context: vscode.ExtensionContext, authService: AuthService): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('moodleSubmit.logout', async () => {
      await authService.logout();
    }),
  );
}
