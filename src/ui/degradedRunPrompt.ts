import * as vscode from 'vscode';
import type { SuspiciousTest } from '../capture/evidence';

const MAX_LISTED = 10;

export function describeFinding(finding: SuspiciousTest): string {
  const name = finding.testSuite ? `${finding.testSuite}.${finding.testName}` : finding.testName;
  return `${name} — ${finding.reasons.join('; ')}`;
}

/**
 * Warns but never blocks: a client-side block would only teach students to disable the extension.
 * The submitted source shows an emptied test regardless of what is chosen here.
 */
export async function confirmDegradedRun(
  findings: SuspiciousTest[],
  total: number,
): Promise<boolean> {
  if (findings.length === 0) return true;

  const listed = findings.slice(0, MAX_LISTED).map(describeFinding);
  if (findings.length > listed.length) {
    listed.push(`…and ${findings.length - listed.length} more`);
  }

  const choice = await vscode.window.showWarningMessage(
    `${findings.length} of ${total} tests look like they may have been emptied or disabled.`,
    { modal: true, detail: listed.join('\n') },
    'Submit anyway',
  );
  return choice === 'Submit anyway';
}
