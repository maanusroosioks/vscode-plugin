import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestRunnerAdapter } from './types';
import type { NormalizedTestCase } from '../core/types';
import { cleanupReport, pathExists, runCommand, tempReportPath } from '../util/shell';
import { parseJUnitXml } from './parsers/junit-xml-parser';

const DETECT_FILES = ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'conftest.py'];

export const pytestAdapter: TestRunnerAdapter = {
  id: 'pytest',
  displayName: 'pytest',
  language: 'python',

  async detect(folderPath) {
    for (const file of DETECT_FILES) {
      if (await pathExists(join(folderPath, file))) {
        return true;
      }
    }
    return false;
  },

  async run(folderPath, opts) {
    const reportPath = tempReportPath('pytest', 'xml');
    const cleanup = (): Promise<void> => cleanupReport(reportPath);

    try {
      const pythonExe = process.platform === 'win32' ? 'python' : 'python3';
      const baseCommand = opts.commandOverride ?? `${pythonExe} -m pytest`;
      const command = `${baseCommand} --junit-xml="${reportPath}"`;
      const startedAt = Date.now();
      const { exitCode, stdout, stderr } = await runCommand(command, {
        cwd: folderPath,
        signal: opts.signal,
        onOutput: opts.onOutput,
      });
      const finishedAt = Date.now();

      let results: NormalizedTestCase[];
      try {
        results = parseJUnitXml(await readFile(reportPath, 'utf8'));
      } catch {
        results = [];
      }

      return {
        run: {
          adapterId: 'pytest',
          language: 'python',
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
