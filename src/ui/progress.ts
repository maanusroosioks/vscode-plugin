import * as vscode from 'vscode';

export interface ProgressHandle {
  report(message: string): void;
  signal: AbortSignal;
}

export async function withProgress<T>(
  title: string,
  task: (progress: ProgressHandle) => Promise<T>,
): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    async (progress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => controller.abort());
      try {
        return await task({
          report: (message) => progress.report({ message }),
          signal: controller.signal,
        });
      } finally {
        sub.dispose();
      }
    },
  );
}
