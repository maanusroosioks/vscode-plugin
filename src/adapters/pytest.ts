import { defineAdapter } from './define';
import { anyExists, cleanupReport, tempReportPath } from '../util/shell';
import { parseJUnitXmlFile } from './parsers/junit-xml-parser';

const DETECT_FILES = ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'conftest.py'];

export const pytestAdapter = defineAdapter({
  id: 'pytest',
  displayName: 'pytest',
  language: 'python',

  detect: (folderPath) => anyExists(folderPath, DETECT_FILES),

  async prepare(folderPath, opts) {
    const reportPath = tempReportPath('pytest', 'xml');
    const pythonExe = process.platform === 'win32' ? 'python' : 'python3';
    const baseCommand = opts.commandOverride ?? `${pythonExe} -m pytest`;

    return {
      command: `${baseCommand} --junit-xml="${reportPath}"`,
      parse: () => parseJUnitXmlFile(reportPath),
      cleanup: () => cleanupReport(reportPath),
    };
  },
});
