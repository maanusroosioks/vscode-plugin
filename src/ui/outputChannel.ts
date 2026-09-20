import * as vscode from 'vscode';
import type { Logger } from '../core/ports';

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Moodle Test Submit');
  }
  return channel;
}

export function createOutputChannelLogger(): Logger {
  return {
    log(message: string): void {
      if (!message) return;
      getOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
    },
  };
}
