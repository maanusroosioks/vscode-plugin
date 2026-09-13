import { join } from 'node:path';
import type { TestRunnerAdapter } from './types';
import { pathExists, removeDir, runCommand } from '../util/shell';
import { parseJUnitXmlDirectory } from './parsers/junit-xml-parser';

const REPORT_DIR = 'build/test-results/test';

async function resolveGradleCommand(folderPath: string): Promise<string> {
  const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const wrapperPath = join(folderPath, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  return (await pathExists(wrapperPath)) ? `${wrapper} cleanTest test` : 'gradle cleanTest test';
}

export const gradleJunitAdapter: TestRunnerAdapter = {
  id: 'gradle-junit',
  displayName: 'Gradle (JUnit)',
  language: 'java',

  async detect(folderPath) {
    return (
      (await pathExists(join(folderPath, 'build.gradle'))) ||
      (await pathExists(join(folderPath, 'build.gradle.kts')))
    );
  },

  async run(folderPath, opts) {
    const command = opts.commandOverride ?? (await resolveGradleCommand(folderPath));
    const reportPath = join(folderPath, REPORT_DIR);
    await removeDir(reportPath);
    const startedAt = Date.now();
    const { exitCode, stdout, stderr } = await runCommand(command, {
      cwd: folderPath,
      signal: opts.signal,
      onOutput: opts.onOutput,
    });
    const finishedAt = Date.now();

    const results = await parseJUnitXmlDirectory(reportPath);

    return {
      run: {
        adapterId: 'gradle-junit',
        language: 'java',
        startedAt,
        finishedAt,
        results,
        rawReportPath: reportPath,
      },
      stdout,
      stderr,
      exitCode,
      cleanup: async () => {},
    };
  },
};
