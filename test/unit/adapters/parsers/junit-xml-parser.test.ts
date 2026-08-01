import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseJUnitXml,
  parseJUnitXmlDirectory,
} from '../../../../src/adapters/parsers/junit-xml-parser';

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

  it('with dirName, only parses reports inside a directory of that name (reactor layout)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'junit-reactor-'));
    await mkdir(join(root, 'mod-a', 'target', 'surefire-reports'), { recursive: true });
    await mkdir(join(root, 'mod-b', 'target', 'surefire-reports'), { recursive: true });
    await mkdir(join(root, 'src', 'test'), { recursive: true });
    await writeFile(join(root, 'mod-a', 'target', 'surefire-reports', 'TEST-a.xml'), MINIMAL_XML, 'utf8');
    await writeFile(join(root, 'mod-b', 'target', 'surefire-reports', 'TEST-b.xml'), MINIMAL_XML, 'utf8');
    // Noise that must be ignored: an XML file outside a surefire-reports dir, and one under src/.
    await writeFile(join(root, 'mod-a', 'target', 'other.xml'), MINIMAL_XML, 'utf8');
    await writeFile(join(root, 'src', 'test', 'TEST-nope.xml'), MINIMAL_XML, 'utf8');

    expect(await parseJUnitXmlDirectory(root, { dirName: 'surefire-reports' })).toHaveLength(2);
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
