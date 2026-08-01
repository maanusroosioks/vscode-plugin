import * as vscode from 'vscode';
import { getServiceUrl } from './config/settings';

const WALKTHROUGH_ID = 'setup';
const NUDGE_DISMISSED_KEY = 'moodleSubmit.onboardingDismissed';

export function isConfigured(): boolean {
  return getServiceUrl().trim().length > 0;
}

/**
 * Keeps the `moodleSubmit.configured` context key in sync with settings so the
 * walkthrough's first step ticks itself off and `when` clauses can react.
 */
export function refreshConfiguredContext(): void {
  void vscode.commands.executeCommand('setContext', 'moodleSubmit.configured', isConfigured());
}

export async function openSetupWalkthrough(context: vscode.ExtensionContext): Promise<void> {
  await vscode.commands.executeCommand(
    'workbench.action.openWalkthrough',
    `${context.extension.id}#${WALKTHROUGH_ID}`,
    false,
  );
}

/**
 * One-time proactive nudge on startup. Silent once the extension is configured
 * or once the user has dismissed it.
 */
export async function maybePromptOnboarding(context: vscode.ExtensionContext): Promise<void> {
  if (isConfigured()) return;
  if (context.globalState.get<boolean>(NUDGE_DISMISSED_KEY)) return;

  const choice = await vscode.window.showInformationMessage(
    'Moodle Test Submit needs a one-time setup before you can submit results.',
    'Start setup',
    "Don't ask again",
  );

  if (choice === 'Start setup') {
    await openSetupWalkthrough(context);
  } else if (choice === "Don't ask again") {
    await context.globalState.update(NUDGE_DISMISSED_KEY, true);
  }
}

/**
 * Just-in-time guard for commands that submit. Offers to finish setup and
 * returns whether the caller should proceed. A `false` return means the user
 * backed out — abort quietly, no error.
 */
export async function ensureConfigured(context: vscode.ExtensionContext): Promise<boolean> {
  if (isConfigured()) return true;

  const pick = await vscode.window.showWarningMessage(
    'Set the Moodle submission service URL before submitting.',
    'Configure now',
    'Open setup',
  );

  if (pick === 'Configure now') {
    await vscode.commands.executeCommand('moodleSubmit.configureAssignment');
  } else if (pick === 'Open setup') {
    await openSetupWalkthrough(context);
  }

  return isConfigured();
}
