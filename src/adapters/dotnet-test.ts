import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { TestRunnerAdapter } from './types';
import type { NormalizedTestCase } from '../core/types';
import { cleanupReport, runCommand, tempReportPath } from '../util/shell';
import { parseTrx } from './parsers/trx-parser';

export const dotnetTestAdapter: TestRunnerAdapter = {
  id: 'dotnet-test',
  displayName: '.NET (dotnet test)',
  language: 'csharp',

  async detect(folderPath) {
    try {
      const entries = await readdir(folderPath);
      return entries.some((name) => name.endsWith('.csproj') || name.endsWith('.sln'));
    } catch {
      return false;
    }
  },

  async run(folderPath, opts) {
    const reportPath = tempReportPath('dotnet-test', 'trx');
    const cleanup = (): Promise<void> => cleanupReport(reportPath);

    try {
      const resultsDirectory = dirname(reportPath);
      const fileName = basename(reportPath);
      const baseCommand = opts.commandOverride ?? 'dotnet test';
      const command = `${baseCommand} --logger "trx;LogFileName=${fileName}" --results-directory "${resultsDirectory}"`;
      const startedAt = Date.now();
      const { exitCode, stdout, stderr } = await runCommand(command, {
        cwd: folderPath,
        signal: opts.signal,
      });
      const finishedAt = Date.now();

      let results: NormalizedTestCase[];
      try {
        results = parseTrx(await readFile(reportPath, 'utf8'));
      } catch {
        results = [];
      }

      return {
        run: {
          adapterId: 'dotnet-test',
          language: 'csharp',
          startedAt,
          finishedAt,
          results,
          rawReportPath: reportPath,
        },
        stdout,
        stderr,
        exitCode,
        cleanup,
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};
