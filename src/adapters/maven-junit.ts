import { join } from 'node:path';
import { defineAdapter } from './define';
import { pathExists } from '../util/shell';
import { clearReportDirs, parseJUnitXmlDirectory } from './parsers/junit-xml-parser';

/** One per module in a reactor build, under `<module>/target/`. */
const REPORT_DIR = 'surefire-reports';

export const mavenJunitAdapter = defineAdapter({
  id: 'maven-junit',
  displayName: 'Maven (JUnit)',
  language: 'java',

  detect: (folderPath) => pathExists(join(folderPath, 'pom.xml')),

  async prepare(folderPath, opts) {
    // Surefire leaves reports in place for modules it doesn't reach this run.
    await clearReportDirs(folderPath, REPORT_DIR);

    return {
      command: opts.commandOverride ?? 'mvn -B test',
      parse: (startedAt) =>
        parseJUnitXmlDirectory(folderPath, {
          reportDir: REPORT_DIR,
          since: startedAt,
          onWarning: (message) => opts.logger?.log(message),
        }),
    };
  },
});
