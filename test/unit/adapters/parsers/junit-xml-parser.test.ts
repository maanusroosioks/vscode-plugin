import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathExists } from '../../../../src/util/shell';
import {
  clearReportDirs,
  parseJUnitXml,
  parseJUnitXmlDirectory,
  parseJUnitXmlFile,
} from '../../../../src/adapters/parsers/junit-xml-parser';
import { ReportUnavailableError } from '../../../../src/adapters/parsers/report-file';

const FIXTURES_DIR = join(__dirname, '../../fixtures/junit');

const MINIMAL_XML = `<?xml version="1.0"?>
<testsuite name="com.example.SampleTest">
  <testcase classname="com.example.SampleTest" name="works" time="0.01"/>
</testsuite>`;

describe('parseJUnitXml', () => {
  it('parses a Surefire-style report (single root testsuite)', async () => {
    const xml = await readFile(join(FIXTURES_DIR, 'sample-surefire-report.xml'), 'utf8');
    const results = parseJUnitXml(xml);

    expect(results).toHaveLength(3);

    const passed = results.find((r) => r.testName === 'addsTwoNumbers');
    expect(passed).toMatchObject({ status: 'PASSED', testSuite: 'com.example.CalculatorTest', durationMs: 12 });

    const failed = results.find((r) => r.testName === 'dividesByZero');
    expect(failed?.status).toBe('FAILED');
    expect(failed?.message).toContain('expected exception');
    expect(failed?.stackTrace).toContain('AssertionError');

    const skipped = results.find((r) => r.testName === 'ignoredForNow');
    expect(skipped?.status).toBe('SKIPPED');
  });

  it('parses a pytest-style report (testsuites wrapper, includes an error case)', async () => {
    const xml = await readFile(join(FIXTURES_DIR, 'sample-pytest-junit.xml'), 'utf8');
    const results = parseJUnitXml(xml);

    expect(results).toHaveLength(4);
    expect(results.filter((r) => r.status === 'PASSED')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'FAILED')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'ERROR')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'SKIPPED')).toHaveLength(1);

    const errored = results.find((r) => r.testName === 'test_reads_missing_file');
    expect(errored?.message).toContain('FileNotFoundError');

    // The <testsuite> is named "pytest"; only the case carries the owning module.
    expect(results.every((r) => r.testSuite === 'test_calculator')).toBe(true);
  });

  it('falls back to the suite name when a case has no classname', () => {
    const results = parseJUnitXml(`<?xml version="1.0"?>
<testsuite name="com.example.SampleTest">
  <testcase name="works" time="0.01"/>
</testsuite>`);

    expect(results[0].testSuite).toBe('com.example.SampleTest');
  });
});

describe('parseJUnitXmlDirectory', () => {
  it('returns nothing for a directory that does not exist', async () => {
    expect(await parseJUnitXmlDirectory(join(tmpdir(), 'no-such-dir-xyz'))).toHaveLength(0);
  });

  it('recurses into subdirectories (multi-module layout)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'junit-multimodule-'));
    await mkdir(join(dir, 'module-a'), { recursive: true });
    await mkdir(join(dir, 'module-b'), { recursive: true });
    await writeFile(join(dir, 'module-a', 'TEST-a.xml'), MINIMAL_XML, 'utf8');
    await writeFile(join(dir, 'module-b', 'TEST-b.xml'), MINIMAL_XML, 'utf8');

    expect(await parseJUnitXmlDirectory(dir)).toHaveLength(2);
  });

  it('parses reports sitting directly in the directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'junit-flat-'));
    await writeFile(join(dir, 'TEST-com.example.SampleTest.xml'), MINIMAL_XML, 'utf8');

    expect(await parseJUnitXmlDirectory(dir)).toHaveLength(1);
  });

  it('with reportDir, only parses reports inside a matching directory (reactor layout)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'junit-reactor-'));
    await mkdir(join(root, 'mod-a', 'target', 'surefire-reports'), { recursive: true });
    await mkdir(join(root, 'mod-b', 'target', 'surefire-reports'), { recursive: true });
    await mkdir(join(root, 'src', 'test'), { recursive: true });
    await writeFile(join(root, 'mod-a', 'target', 'surefire-reports', 'TEST-a.xml'), MINIMAL_XML, 'utf8');
    await writeFile(join(root, 'mod-b', 'target', 'surefire-reports', 'TEST-b.xml'), MINIMAL_XML, 'utf8');
    // Noise that must be ignored: an XML file outside a surefire-reports dir, and one under src/.
    await writeFile(join(root, 'mod-a', 'target', 'other.xml'), MINIMAL_XML, 'utf8');
    await writeFile(join(root, 'src', 'test', 'TEST-nope.xml'), MINIMAL_XML, 'utf8');

    expect(await parseJUnitXmlDirectory(root, { reportDir: 'surefire-reports' })).toHaveLength(2);
  });

  it('with since, ignores report files left over from an earlier run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'junit-stale-'));
    const stalePath = join(dir, 'TEST-stale.xml');
    const freshPath = join(dir, 'TEST-fresh.xml');
    await writeFile(stalePath, MINIMAL_XML, 'utf8');
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(stalePath, longAgo, longAgo);

    const since = Date.now();
    await writeFile(freshPath, MINIMAL_XML, 'utf8');

    expect(await parseJUnitXmlDirectory(dir, { since })).toHaveLength(1);
    expect(await parseJUnitXmlDirectory(dir)).toHaveLength(2);
  });
});

describe('parseJUnitXml nested suites', () => {
  it('collects test cases from nested <testsuite> elements', () => {
    const xml = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="outer">
    <testcase classname="outer" name="outer_test" time="0.01"/>
    <testsuite name="inner">
      <testcase classname="inner" name="inner_test" time="0.02"/>
    </testsuite>
  </testsuite>
</testsuites>`;
    const results = parseJUnitXml(xml);
    expect(results.map((r) => r.testName).sort()).toEqual(['inner_test', 'outer_test']);
  });
});

describe('parseJUnitXmlDirectory nested report dirs', () => {
  it('with a multi-segment reportDir, finds per-module report dirs (Gradle layout)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gradle-multi-'));
    const reportDir = join('build', 'test-results', 'test');
    for (const module of ['app', 'lib']) {
      await mkdir(join(root, module, reportDir), { recursive: true });
      await writeFile(join(root, module, reportDir, `TEST-${module}.xml`), MINIMAL_XML, 'utf8');
    }
    // The binary-results sibling Gradle also writes, which must not match.
    await mkdir(join(root, 'app', 'build', 'test-results', 'binary'), { recursive: true });
    await writeFile(
      join(root, 'app', 'build', 'test-results', 'binary', 'TEST-app.xml'),
      MINIMAL_XML,
      'utf8',
    );

    expect(await parseJUnitXmlDirectory(root, { reportDir: 'build/test-results/test' })).toHaveLength(2);
  });

  it('returns results in a stable order regardless of filesystem ordering', async () => {
    const root = await mkdtemp(join(tmpdir(), 'junit-order-'));
    for (const name of ['c', 'a', 'b']) {
      await mkdir(join(root, name), { recursive: true });
      await writeFile(
        join(root, name, 'TEST.xml'),
        MINIMAL_XML.replace('name="works"', `name="works_${name}"`),
        'utf8',
      );
    }

    const results = await parseJUnitXmlDirectory(root);
    expect(results.map((r) => r.testName)).toEqual(['works_a', 'works_b', 'works_c']);
  });

  it('skips an unparseable report but keeps the rest, warning once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'junit-bad-'));
    await writeFile(join(root, 'TEST-good.xml'), MINIMAL_XML, 'utf8');
    await writeFile(join(root, 'TEST-bad.xml'), '', 'utf8');

    const warnings: string[] = [];
    const results = await parseJUnitXmlDirectory(root, { onWarning: (m) => warnings.push(m) });

    expect(results).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('TEST-bad.xml');
  });
});

describe('parseJUnitXmlFile', () => {
  it('reports a missing report rather than returning nothing', async () => {
    const path = join(tmpdir(), 'no-such-report-xyz.xml');
    await expect(parseJUnitXmlFile(path)).rejects.toBeInstanceOf(ReportUnavailableError);
    await expect(parseJUnitXmlFile(path)).rejects.toThrow('no report was written');
  });

  it('reports a file that is not a JUnit report rather than returning nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'junit-malformed-'));
    const path = join(dir, 'TEST-broken.xml');
    await writeFile(path, '', 'utf8');

    await expect(parseJUnitXmlFile(path)).rejects.toThrow('could not be parsed');
  });

  it('still accepts a valid report that genuinely collected no tests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'junit-empty-'));
    const path = join(dir, 'TEST-empty.xml');
    await writeFile(path, '<?xml version="1.0"?><testsuites/>', 'utf8');

    await expect(parseJUnitXmlFile(path)).resolves.toEqual([]);
  });
});

describe('clearReportDirs', () => {
  it('removes matching report dirs in every module, leaving everything else', async () => {
    const root = await mkdtemp(join(tmpdir(), 'junit-clear-'));
    for (const module of ['mod-a', 'mod-b']) {
      await mkdir(join(root, module, 'target', 'surefire-reports'), { recursive: true });
      await writeFile(
        join(root, module, 'target', 'surefire-reports', 'TEST-old.xml'),
        MINIMAL_XML,
        'utf8',
      );
      await writeFile(join(root, module, 'target', 'keep.xml'), MINIMAL_XML, 'utf8');
    }

    await clearReportDirs(root, 'surefire-reports');

    expect(await parseJUnitXmlDirectory(root, { reportDir: 'surefire-reports' })).toHaveLength(0);
    expect(await pathExists(join(root, 'mod-a', 'target', 'keep.xml'))).toBe(true);
  });

  it('refuses to clear the whole tree when given no directory to match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'junit-clear-guard-'));
    await expect(clearReportDirs(root, '')).rejects.toThrow('refusing to clear');
    expect(await pathExists(root)).toBe(true);
  });
});
