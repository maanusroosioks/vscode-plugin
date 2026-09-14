import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anyExists, cleanupReport, pathExists, tempReportPath } from '../../../src/util/shell';

describe('anyExists', () => {
  it('is true when at least one of the names is present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'any-exists-'));
    await writeFile(join(dir, 'build.gradle.kts'), '', 'utf8');

    expect(await anyExists(dir, ['build.gradle', 'build.gradle.kts'])).toBe(true);
    expect(await anyExists(dir, ['pom.xml', 'pytest.ini'])).toBe(false);
    expect(await anyExists(dir, [])).toBe(false);
  });
});

describe('cleanupReport', () => {
  it('removes a report it created under the temp directory', async () => {
    const path = tempReportPath('test', 'xml');
    await writeFile(path, '<testsuites/>', 'utf8');

    await cleanupReport(path);
    expect(await pathExists(path)).toBe(false);
  });

  it('refuses paths outside the temp directory, including a same-prefix sibling', async () => {
    // `<tmp>2` shares a string prefix with `<tmp>` but is not inside it.
    const sibling = `${resolve(tmpdir())}2`;
    await mkdir(sibling, { recursive: true });
    const path = join(sibling, 'not-ours.xml');
    await writeFile(path, 'keep me', 'utf8');

    await cleanupReport(path);
    expect(await pathExists(path)).toBe(true);
  });

  it('refuses the temp directory itself', async () => {
    await cleanupReport(tmpdir());
    expect(await pathExists(tmpdir())).toBe(true);
  });
});

describe('tempReportPath', () => {
  it('never hands out the same path twice', () => {
    const paths = new Set(Array.from({ length: 50 }, () => tempReportPath('pytest', 'xml')));
    expect(paths.size).toBe(50);
    expect(dirname([...paths][0])).toBe(resolve(tmpdir()));
  });
});
