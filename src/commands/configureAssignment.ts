import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { AuthService } from '../auth/authService';
import {
  getAssignmentKeySetting,
  getRequestTimeoutMs,
  getServiceUrl,
  setAssignmentKey,
  setServiceUrl,
} from '../config/settings';
import { pathExists } from '../util/shell';
import { refreshConfiguredContext } from '../onboarding';

const WORKSPACE_CONFIG_FILE_NAME = '.moodle-submit.json';

function validateUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'The service URL is required.';
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'Enter a full URL, e.g. https://moodle-bridge.example.edu';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'The URL must start with http:// or https://';
  }
  return undefined;
}

async function reportReachability(baseUrl: string): Promise<void> {
  const url = baseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(getRequestTimeoutMs(), 5000));
  try {
    await fetch(url, { method: 'HEAD', signal: controller.signal });
    void vscode.window.showInformationMessage(`Reached ${url}.`);
  } catch {
    void vscode.window.showWarningMessage(
      `Couldn't reach ${url}. Saved anyway — re-check the URL if submissions fail.`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  const pick = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { placeHolder: `Which project should get the ${WORKSPACE_CONFIG_FILE_NAME} file?` },
  );
  return pick?.folder;
}

async function offerAssignmentFile(): Promise<void> {
  const folder = await pickWorkspaceFolder();
  if (!folder) {
    return;
  }

  const target = join(folder.uri.fsPath, WORKSPACE_CONFIG_FILE_NAME);
  if (await pathExists(target)) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `Add a ${WORKSPACE_CONFIG_FILE_NAME} to "${folder.name}" for a per-project assignment key?`,
    'Create',
    'Skip',
  );
  if (choice !== 'Create') {
    return;
  }

  const body = `${JSON.stringify({ assignmentKey: 'REPLACE_WITH_YOUR_ASSIGNMENT_KEY' }, null, 2)}\n`;
  try {
    await writeFile(target, body, { flag: 'wx' });
  } catch {
    void vscode.window.showWarningMessage(`Could not create ${target}.`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc);
}

export function registerConfigureAssignmentCommand(
  context: vscode.ExtensionContext,
  authService: AuthService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('moodleSubmit.configureAssignment', async () => {
      const serviceUrl = await vscode.window.showInputBox({
        prompt: 'Moodle submission service URL',
        placeHolder: 'https://moodle-bridge.example.edu',
        value: getServiceUrl(),
        ignoreFocusOut: true,
        validateInput: validateUrl,
      });
      if (serviceUrl === undefined) {
        return;
      }
      const trimmedUrl = serviceUrl.trim();
      await setServiceUrl(trimmedUrl);
      refreshConfiguredContext();
      await reportReachability(trimmedUrl);

      const assignmentKey = await vscode.window.showInputBox({
        prompt: 'Fallback assignment key (used only when a project has no .moodle-submit.json)',
        value: getAssignmentKeySetting() ?? '',
        ignoreFocusOut: true,
      });
      if (assignmentKey !== undefined) {
        await setAssignmentKey(assignmentKey.trim());
      }

      if (!(await authService.isSignedIn())) {
        const choice = await vscode.window.showInformationMessage(
          'Sign in with Microsoft now to finish setup?',
          'Sign in',
          'Later',
        );
        if (choice === 'Sign in') {
          await vscode.commands.executeCommand('moodleSubmit.login');
        }
      }

      await offerAssignmentFile();

      void vscode.window.showInformationMessage('Moodle Submit configuration saved.');
    }),
  );
}
