import * as vscode from 'vscode';

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('moodleSubmit');
}

export function getServiceUrl(): string {
  return config().get<string>('serviceUrl', '');
}

export function getRequestTimeoutMs(): number {
  return config().get<number>('requestTimeoutMs', 15000);
}

export function getAssignmentKeySetting(): string | undefined {
  const value = config().get<string>('assignmentKey', '').trim();
  return value ? value : undefined;
}

export function getAuthScopes(): string[] {
  return config().get<string[]>('authScopes', []);
}

export function getTestCommandOverrides(): Record<string, string> {
  return config().get<Record<string, string>>('testCommandOverrides', {});
}

export function getPreferredAdapterId(): string | undefined {
  return config().get<string>('preferredAdapter');
}

function writeTarget(): vscode.ConfigurationTarget {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

export async function setServiceUrl(value: string): Promise<void> {
  await config().update('serviceUrl', value, writeTarget());
}

export async function setAssignmentKey(value: string): Promise<void> {
  await config().update('assignmentKey', value, writeTarget());
}
