import { exec } from 'node:child_process';
import { tmpdir } from 'node:os';
import { access, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CancelledError } from '../core/errors';

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions {
  cwd: string;
  signal?: AbortSignal;
}

export function runCommand(command: string, options: RunCommandOptions): Promise<RunCommandResult> {
  const { cwd, signal } = options;
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    exec(
      command,
      { cwd, signal, killSignal: 'SIGTERM', windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { name?: string }) | null;
        if (signal?.aborted || err?.name === 'AbortError' || err?.code === 'ABORT_ERR') {
          reject(new CancelledError());
          return;
        }
        const code = err ? err.code : 0;
        const exitCode = typeof code === 'number' ? code : err ? 1 : 0;
        resolvePromise({ exitCode, stdout, stderr });
      },
    );
  });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

let reportCounter = 0;

export function tempReportPath(adapterId: string, extension: string): string {
  reportCounter += 1;
  return resolve(tmpdir(), `moodle-submit-${adapterId}-${Date.now()}-${reportCounter}.${extension}`);
}

export async function cleanupReport(path: string): Promise<void> {
  const normalized = resolve(path);
  if (!normalized.startsWith(resolve(tmpdir()))) {
    return;
  }
  await rm(normalized, { recursive: true, force: true });
}
