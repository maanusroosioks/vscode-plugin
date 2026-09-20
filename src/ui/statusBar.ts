import * as vscode from 'vscode';
import type { RunSummary, StatusReporter } from '../core/ports';

export type DisposableStatusReporter = StatusReporter & vscode.Disposable;

export function createStatusReporter(): DisposableStatusReporter {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = 'moodleSubmit.showOutput';

  const idle = (): void => {
    item.text = '$(beaker) Moodle Submit';
    item.tooltip = undefined;
    item.backgroundColor = undefined;
  };

  idle();
  item.show();

  return {
    running(): void {
      item.text = '$(sync~spin) Running tests…';
      item.tooltip = undefined;
      item.backgroundColor = undefined;
    },
    result(summary: RunSummary): void {
      const allPassed = summary.failed === 0;
      item.text = allPassed
        ? `$(check) ${summary.passed}/${summary.total} passed`
        : `$(x) ${summary.failed}/${summary.total} failed`;
      item.tooltip = undefined;
      item.backgroundColor = allPassed
        ? undefined
        : new vscode.ThemeColor('statusBarItem.errorBackground');
    },
    error(message: string): void {
      item.text = '$(error) Moodle submit failed';
      item.tooltip = message;
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    },
    idle,
    dispose(): void {
      item.dispose();
    },
  };
}
