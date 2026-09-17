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

export interface SourceCaptureSettings {
  captureSource: boolean;
  maxTestChars: number;
  maxTotalChars: number;
}

// Hard ceilings so a student can't set a huge value and use submissions to hammer the gateway.
const MAX_TEST_CHARS_CEILING = 20_000;
const MAX_TOTAL_CHARS_CEILING = 500_000;

/** Defaults live here and in package.json; a non-numeric or absurd setting falls back to them. */
function charLimit(key: string, fallback: number, ceiling: number): number {
  const value = config().get<number>(key, fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), ceiling);
}

export function getSourceCaptureSettings(): SourceCaptureSettings {
  return {
    captureSource: config().get<boolean>('submitTestSource', true),
    maxTestChars: charLimit('maxTestSourceChars', 8_000, MAX_TEST_CHARS_CEILING),
    maxTotalChars: charLimit('maxTotalSourceChars', 200_000, MAX_TOTAL_CHARS_CEILING),
  };
}

export function getWarnOnSuspiciousTests(): boolean {
  return config().get<boolean>('warnOnSuspiciousTests', true);
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
