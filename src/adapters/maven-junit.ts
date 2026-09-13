import { join } from 'node:path';
import type { TestRunnerAdapter } from './types';
import { pathExists, runCommand } from '../util/shell';
import { parseJUnitXmlDirectory } from './parsers/junit-xml-parser';

export const mavenJunitAdapter: TestRunnerAdapter = {
  id: 'maven-junit',
  displayName: 'Maven (JUnit)',
  language: 'java',

  async detect(folderPath) {
    return pathExists(join(folderPath, 'pom.xml'));
  },

  async run(folderPath, opts) {
    const command = opts.commandOverride ?? 'mvn -B test';
    const startedAt = Date.now();
    const { exitCode, stdout, stderr } = await runCommand(command, {
      cwd: folderPath,
      signal: opts.signal,
      onOutput: opts.onOutput,
    });
    const finishedAt = Date.now();

    const results = await parseJUnitXmlDirectory(folderPath, {
      dirName: 'surefire-reports',
      since: startedAt,
    });

    return {
      run: {
        adapterId: 'maven-junit',
        language: 'java',
        startedAt,
        finishedAt,
        results,
        rawReportPath: folderPath,
      },
      stdout,
      stderr,
      exitCode,
      cleanup: async () => {},
    };
  },
};
