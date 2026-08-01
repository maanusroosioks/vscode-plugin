import * as vscode from 'vscode';


export interface Logger {
  log(message: string): void;
}

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
