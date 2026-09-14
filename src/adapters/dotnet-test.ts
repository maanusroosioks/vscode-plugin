import { readdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { defineAdapter } from './define';
import { cleanupReport, tempReportPath } from '../util/shell';
import { parseTrxFile } from './parsers/trx-parser';

const PROJECT_EXTENSIONS = ['.csproj', '.sln'];

export const dotnetTestAdapter = defineAdapter({
  id: 'dotnet-test',
  displayName: '.NET (dotnet test)',
  language: 'csharp',

  async detect(folderPath) {
    try {
      const entries = await readdir(folderPath);
      return entries.some((name) => PROJECT_EXTENSIONS.some((ext) => name.endsWith(ext)));
    } catch {
      return false;
    }
  },

  async prepare(folderPath, opts) {
    const reportPath = tempReportPath('dotnet-test', 'trx');
    const baseCommand = opts.commandOverride ?? 'dotnet test';
    const logger = `--logger "trx;LogFileName=${basename(reportPath)}"`;
    const resultsDir = `--results-directory "${dirname(reportPath)}"`;

    return {
      command: `${baseCommand} ${logger} ${resultsDir}`,
      parse: () => parseTrxFile(reportPath),
      cleanup: () => cleanupReport(reportPath),
    };
  },
});
