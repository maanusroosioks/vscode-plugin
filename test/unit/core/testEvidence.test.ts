import { readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../src/core/hash';
import { TestLocationResolver } from '../../../src/core/testLocation';
import {
  collectTestEvidence,
  describeSuspiciousTests,
  type CollectEvidenceOptions,
  type TestEvidence,
} from '../../../src/core/testEvidence';
import type { NormalizedTestCase, NormalizedTestRun } from '../../../src/core/types';

const FOLDER = resolve('/project');
const PYTHON_SOURCE = readFileSync(
  join(__dirname, '../fixtures/source/python/test_calculator.py'),
  'utf8',
);

interface Harness {
  evidence: TestEvidence;
  reads: string[];
}

function run(results: NormalizedTestCase[], language = 'python'): NormalizedTestRun {
  return { adapterId: 'pytest', language, startedAt: 1000, finishedAt: 2000, results };
}

async function collect(
  testRun: NormalizedTestRun,
  files: Record<string, string>,
  overrides: Partial<CollectEvidenceOptions> = {},
): Promise<Harness> {
  const absolute = new Map(
    Object.entries(files).map(([path, content]) => [resolve(FOLDER, path), content]),
  );
  const reads: string[] = [];

  const resolver = new TestLocationResolver(FOLDER, testRun.language, {
    exists: async (path) => absolute.has(resolve(path)),
    listDirs: async () => [],
  });

  const evidence = await collectTestEvidence(testRun, resolver, {
    folderPath: FOLDER,
    captureSource: true,
    maxTestChars: 8000,
    maxTotalChars: 200000,
    readFile: async (path) => {
      reads.push(path);
      const content = absolute.get(resolve(path));
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    ...overrides,
  });

  return { evidence, reads };
}

const PYTHON_FILES = { 'test_calculator.py': PYTHON_SOURCE };

describe('collectTestEvidence — source capture', () => {
  it('captures just the matched test, decorator included', async () => {
    const { evidence } = await collect(
      run([
        {
          testSuite: 'test_calculator',
          testName: 'test_divide_returns_quotient[10-2-5]',
          status: 'PASSED',
        },
      ]),
      PYTHON_FILES,
    );

    const source = evidence.payload.sources[0];
    expect(source.kind).toBe('TEST');
    expect(source.filePath).toBe('test_calculator.py');
    expect(source.code).toContain('@pytest.mark.parametrize');
    expect(source.code).toContain('assert divide(a, b) == expected');
    expect(source.code).not.toContain('def test_uses_a_nested_helper');
    expect(source.startLine).toBeLessThan(source.endLine as number);
    expect(source.truncated).toBeUndefined();
  });

  it('points an unmatched test at the file instead of copying it', async () => {
    const { evidence } = await collect(
      run([{ testSuite: 'test_calculator', testName: 'test_not_in_the_file', status: 'PASSED' }]),
      PYTHON_FILES,
    );

    expect(evidence.payload.sources[0].kind).toBe('FILE');
    expect(evidence.payload.sources[0].code).toBeUndefined();
    expect(evidence.payload.sources[0].filePath).toBe('test_calculator.py');
    expect(evidence.integrity[0].integrity).toEqual({ located: false });
    expect(evidence.payload.files[0].content).toBe(PYTHON_SOURCE);
  });

  it('sends one copy of the file however many of its tests went unmatched', async () => {
    // The Spock/ScalaTest case: the scanner finds no declarations, so every result falls back.
    const unmatched = Array.from({ length: 20 }, (_, index) => ({
      testSuite: 'test_calculator',
      testName: `spec_${index}`,
      status: 'PASSED' as const,
    }));
    const { evidence } = await collect(run(unmatched), PYTHON_FILES);

    expect(evidence.payload.sources.every((source) => source.kind === 'FILE')).toBe(true);
    expect(evidence.payload.sources.every((source) => source.code === undefined)).toBe(true);
    expect(evidence.payload.files).toHaveLength(1);

    const serialized = JSON.stringify(evidence);
    expect(serialized.split('assert add(2, 3) == 5').length - 1).toBe(1);
    expect(serialized.length).toBeLessThan(PYTHON_SOURCE.length * 20);
  });

  it('reports NONE when no source file can be located at all', async () => {
    const { evidence } = await collect(
      run([{ testSuite: 'nowhere', testName: 'test_x', status: 'PASSED' }]),
      PYTHON_FILES,
    );

    expect(evidence.payload.sources[0]).toEqual({ kind: 'NONE' });
    expect(evidence.integrity[0].integrity.located).toBe(false);
  });

  it('reads and scans each file once, however many of its tests ran', async () => {
    const { reads } = await collect(
      run([
        { testSuite: 'test_calculator', testName: 'test_add_returns_sum', status: 'PASSED' },
        { testSuite: 'test_calculator', testName: 'test_empty_body', status: 'PASSED' },
        { testSuite: 'test_calculator', testName: 'test_async_add', status: 'PASSED' },
      ]),
      PYTHON_FILES,
    );

    expect(reads).toHaveLength(1);
  });
});

describe('collectTestEvidence — paths must not leak the student', () => {
  it('sends a workspace-relative path with forward slashes', async () => {
    const { evidence } = await collect(
      run([{ testSuite: 'tests.test_calculator', testName: 'test_add_returns_sum', status: 'PASSED' }]),
      { [join('tests', 'test_calculator.py')]: PYTHON_SOURCE },
    );

    expect(evidence.payload.sources[0].filePath).toBe('tests/test_calculator.py');
  });

  it('degrades to the basename for a file outside the workspace folder', async () => {
    const outside = resolve('/elsewhere/vendor/test_outside.py');
    const testRun = run([
      {
        testSuite: 'unresolvable',
        testName: 'test_x',
        status: 'FAILED',
        stackTrace: `File "${outside}", line 3, in test_x`,
      },
    ]);

    const resolver = new TestLocationResolver(FOLDER, 'python', {
      exists: async (path) => resolve(path) === outside,
      listDirs: async () => [],
    });
    const evidence = await collectTestEvidence(testRun, resolver, {
      folderPath: FOLDER,
      captureSource: true,
      maxTestChars: 8000,
      maxTotalChars: 200000,
      readFile: async () => 'def test_x():\n    assert True\n',
    });

    expect(evidence.payload.sources[0].filePath).toBe('test_outside.py');
    expect(evidence.payload.sources[0].filePath).not.toContain(sep);
    expect(relative(FOLDER, outside).startsWith('..')).toBe(true);
  });
});

describe('collectTestEvidence — hashes', () => {
  const single = run([
    { testSuite: 'test_calculator', testName: 'test_add_returns_sum', status: 'PASSED' },
  ]);

  it('hashes the untruncated snippet even when the snippet is capped', async () => {
    const full = await collect(single, PYTHON_FILES);
    const capped = await collect(single, PYTHON_FILES, { maxTestChars: 12 });

    expect(capped.evidence.payload.sources[0].truncated).toBe(true);
    expect(capped.evidence.payload.sources[0].code).toContain('more characters]');
    expect(capped.evidence.payload.sources[0].normalizedCodeHash).toBe(
      full.evidence.payload.sources[0].normalizedCodeHash,
    );
  });

  it('keeps normalizedCodeHash stable across reindentation and comment churn', async () => {
    const source = 'def test_add():\n    assert add(2, 3) == 5\n';
    const reformatted = '# a new comment\ndef test_add():\n\n        assert  add(2, 3)  ==  5\n';
    const testRun = run([{ testSuite: 'test_add', testName: 'test_add', status: 'PASSED' }]);

    const before = await collect(testRun, { 'test_add.py': source });
    const after = await collect(testRun, { 'test_add.py': reformatted });

    expect(after.evidence.payload.sources[0].normalizedCodeHash).toBe(
      before.evidence.payload.sources[0].normalizedCodeHash,
    );
    // The file did change, which is what the file hash is for.
    expect(after.evidence.payload.files[0].sha256).not.toBe(before.evidence.payload.files[0].sha256);
  });

  it('changes normalizedCodeHash when a line moves out of a Python block', async () => {
    // Same lines, different nesting: `assert b` stops being conditional. Indentation is syntax.
    const nested = 'def test_x():\n    if cond:\n        assert a\n        assert b\n';
    const flat = 'def test_x():\n    if cond:\n        assert a\n    assert b\n';
    const testRun = run([{ testSuite: 'test_x', testName: 'test_x', status: 'PASSED' }]);

    const before = await collect(testRun, { 'test_x.py': nested });
    const after = await collect(testRun, { 'test_x.py': flat });

    expect(after.evidence.payload.sources[0].normalizedCodeHash).not.toBe(
      before.evidence.payload.sources[0].normalizedCodeHash,
    );
  });

  it('still ignores a wholesale reindent of a Python test', async () => {
    const fourSpace = 'def test_x():\n    if cond:\n        assert a\n        assert b\n';
    const twoSpace = 'def test_x():\n  if cond:\n    assert a\n    assert b\n';
    const testRun = run([{ testSuite: 'test_x', testName: 'test_x', status: 'PASSED' }]);

    const before = await collect(testRun, { 'test_x.py': fourSpace });
    const after = await collect(testRun, { 'test_x.py': twoSpace });

    expect(after.evidence.payload.sources[0].normalizedCodeHash).toBe(
      before.evidence.payload.sources[0].normalizedCodeHash,
    );
  });

  it.each([
    ['python', 'test_x.py', 'def test_x():\n    assert fmt(v) == "a  b"\n', 'def test_x():\n    assert fmt(v) == "a b"\n'],
    [
      'java',
      'test_x.java',
      'class T {\n  @Test\n  void test_x() {\n    assertEquals("a  b", f());\n  }\n}\n',
      'class T {\n  @Test\n  void test_x() {\n    assertEquals("a b", f());\n  }\n}\n',
    ],
  ])('%s: whitespace inside a string literal is part of the value', async (language, file, wide, narrow) => {
    const testRun = run([{ testSuite: 'test_x', testName: 'test_x', status: 'PASSED' }], language);

    const before = await collect(testRun, { [file]: wide });
    const after = await collect(testRun, { [file]: narrow });

    expect(after.evidence.payload.sources[0].normalizedCodeHash).not.toBe(
      before.evidence.payload.sources[0].normalizedCodeHash,
    );
  });

  it('ignores whitespace changes outside string literals', async () => {
    const testRun = run([{ testSuite: 'test_x', testName: 'test_x', status: 'PASSED' }]);

    const before = await collect(testRun, { 'test_x.py': 'def test_x():\n    assert f(v) == "a b"\n' });
    const after = await collect(testRun, { 'test_x.py': 'def test_x():\n    assert  f(v)  ==  "a b"\n' });

    expect(after.evidence.payload.sources[0].normalizedCodeHash).toBe(
      before.evidence.payload.sources[0].normalizedCodeHash,
    );
  });

  it('changes normalizedCodeHash when an expected value changes', async () => {
    const testRun = run([{ testSuite: 'test_add', testName: 'test_add', status: 'PASSED' }]);
    const before = await collect(testRun, {
      'test_add.py': 'def test_add():\n    assert add(2, 3) == 5\n',
    });
    const after = await collect(testRun, {
      'test_add.py': 'def test_add():\n    assert add(2, 3) == 6\n',
    });

    expect(after.evidence.payload.sources[0].normalizedCodeHash).not.toBe(
      before.evidence.payload.sources[0].normalizedCodeHash,
    );
  });

  it('lists each distinct file once, with its hash', async () => {
    const { evidence } = await collect(
      run([
        { testSuite: 'test_calculator', testName: 'test_add_returns_sum', status: 'PASSED' },
        { testSuite: 'test_calculator', testName: 'test_empty_body', status: 'PASSED' },
      ]),
      PYTHON_FILES,
    );

    expect(evidence.payload.files).toEqual([
      {
        path: 'test_calculator.py',
        sha256: sha256Hex(PYTHON_SOURCE),
        content: PYTHON_SOURCE,
      },
    ]);
    // filePath is the join key from a result back into files.
    for (const source of evidence.payload.sources) {
      expect(source.filePath).toBe(evidence.payload.files[0].path);
    }
  });
});

describe('collectTestEvidence — budget and opt-out', () => {
  const three = run([
    { testSuite: 'test_calculator', testName: 'test_add_returns_sum', status: 'PASSED' },
    { testSuite: 'test_calculator', testName: 'test_async_add', status: 'PASSED' },
    { testSuite: 'test_calculator', testName: 'test_empty_body', status: 'PASSED' },
  ]);

  it('drops code but keeps hashes and integrity once the budget is spent', async () => {
    const { evidence } = await collect(three, PYTHON_FILES, { maxTotalChars: 120 });

    expect(evidence.payload.sources[0].code).toBeDefined();

    // Still located, so still `TEST` — only the code is missing.
    const dropped = evidence.payload.sources[evidence.payload.sources.length - 1];
    expect(dropped.kind).toBe('TEST');
    expect(dropped.code).toBeUndefined();
    expect(dropped.normalizedCodeHash).toHaveLength(64);
    expect(evidence.payload.files[0].sha256).toHaveLength(64);
    expect(evidence.integrity[evidence.integrity.length - 1].integrity.located).toBe(true);
  });

  it('opting out of source still submits hashes', async () => {
    const { evidence } = await collect(three, PYTHON_FILES, { captureSource: false });

    for (const source of evidence.payload.sources) {
      expect(source.kind).toBe('TEST');
      expect(source.code).toBeUndefined();
      expect(source.normalizedCodeHash).toHaveLength(64);
    }
    expect(evidence.integrity.every((entry) => entry.integrity.located)).toBe(true);
    expect(evidence.payload.captureDisabled).toBe(true);
    expect(evidence.integrity.filter((entry) => entry.integrity.empty).length).toBe(1);
  });

  it('keeps the truncation notice inside the budget it reports against', async () => {
    const maxTotalChars = 120;
    const { evidence } = await collect(three, PYTHON_FILES, { maxTotalChars, maxTestChars: 50 });

    const captured = evidence.payload.sources.reduce(
      (total, source) => total + (source.code?.length ?? 0),
      0,
    );
    const inFiles = evidence.payload.files.reduce(
      (total, file) => total + (file.content?.length ?? 0),
      0,
    );

    expect(evidence.payload.sources.some((source) => source.truncated)).toBe(true);
    expect(captured + inFiles).toBeLessThanOrEqual(maxTotalChars);
  });

  it('leaves captureDisabled unset when capture is on', async () => {
    const { evidence } = await collect(three, PYTHON_FILES);

    expect(evidence.payload.captureDisabled).toBeUndefined();
    expect(evidence.payload.warningAcknowledged).toBeUndefined();
  });
});

describe('collectTestEvidence — local integrity signals', () => {
  it('computes per-test signals for the pre-submit warning', async () => {
    const { evidence } = await collect(
      run([
        { testSuite: 'test_calculator', testName: 'test_add_returns_sum', status: 'PASSED' },
        { testSuite: 'test_calculator', testName: 'test_empty_body', status: 'PASSED' },
        { testSuite: 'test_calculator', testName: 'test_only_a_docstring', status: 'PASSED' },
        { testSuite: 'test_calculator', testName: 'test_skipped_outright', status: 'SKIPPED' },
        { testSuite: 'nowhere', testName: 'test_missing', status: 'PASSED' },
      ]),
      PYTHON_FILES,
    );

    const integrity = evidence.integrity.map((entry) => entry.integrity);
    expect(integrity.filter((entry) => entry.located)).toHaveLength(4);
    expect(integrity.filter((entry) => entry.empty)).toHaveLength(2);
    expect(integrity.filter((entry) => entry.located && entry.assertionCount === 0)).toHaveLength(2);
    expect(integrity.filter((entry) => entry.skipMarker)).toHaveLength(1);
  });
});

describe('collectTestEvidence — tamper detection', () => {
  const testRun = run([
    { testSuite: 'test_calculator', testName: 'test_add_returns_sum', status: 'PASSED' },
    { testSuite: 'test_calculator', testName: 'test_async_add', status: 'PASSED' },
  ]);

  it('changes the gutted test and the file hash, but leaves its neighbour alone', async () => {
    const gutted = PYTHON_SOURCE.replace(
      'def test_add_returns_sum():\n    assert add(2, 3) == 5',
      'def test_add_returns_sum():\n    pass',
    );
    expect(gutted).not.toBe(PYTHON_SOURCE);

    const before = await collect(testRun, PYTHON_FILES);
    const after = await collect(testRun, { 'test_calculator.py': gutted });

    expect(after.evidence.payload.sources[0].normalizedCodeHash).not.toBe(
      before.evidence.payload.sources[0].normalizedCodeHash,
    );
    expect(after.evidence.payload.sources[1].normalizedCodeHash).toBe(
      before.evidence.payload.sources[1].normalizedCodeHash,
    );
    expect(after.evidence.payload.files[0].sha256).not.toBe(before.evidence.payload.files[0].sha256);

    expect(after.evidence.integrity[0].integrity).toMatchObject({ empty: true, assertionCount: 0 });
    expect(describeSuspiciousTests(after.evidence.integrity)).toEqual([
      {
        testSuite: 'test_calculator',
        testName: 'test_add_returns_sum',
        reasons: ['has an empty body'],
      },
    ]);
  });

  it('moves the file hash but no test hash when sabotage is outside every test body', async () => {
    // The case the file hash exists for: setup/import/helper edits no snippet would show.
    const sabotaged = PYTHON_SOURCE.replace(
      'from calculator import add, divide',
      'from calculator import add, divide\n\nadd = lambda a, b: 5',
    );

    const before = await collect(testRun, PYTHON_FILES);
    const after = await collect(testRun, { 'test_calculator.py': sabotaged });

    for (const [index, source] of after.evidence.payload.sources.entries()) {
      expect(source.normalizedCodeHash).toBe(before.evidence.payload.sources[index].normalizedCodeHash);
    }
    expect(after.evidence.payload.files[0].sha256).not.toBe(before.evidence.payload.files[0].sha256);
    // Nothing about the tests themselves looks wrong — the file hash is the only handle.
    expect(describeSuspiciousTests(after.evidence.integrity)).toEqual([]);
  });

  it('flags a test whose assertion was removed but whose body still does work', async () => {
    const declawed = PYTHON_SOURCE.replace(
      'def test_add_returns_sum():\n    assert add(2, 3) == 5',
      'def test_add_returns_sum():\n    result = add(2, 3)\n    print(result)',
    );
    const { evidence } = await collect(testRun, { 'test_calculator.py': declawed });

    expect(evidence.integrity[0].integrity).toMatchObject({ empty: false, assertionCount: 0 });
    expect(describeSuspiciousTests(evidence.integrity)[0].reasons).toEqual(['makes no assertions']);
  });

  it('flags a test that was disabled rather than fixed', async () => {
    const disabled = PYTHON_SOURCE.replace(
      'def test_add_returns_sum():',
      '@pytest.mark.skip(reason="later")\ndef test_add_returns_sum():',
    );
    const { evidence } = await collect(testRun, { 'test_calculator.py': disabled });

    expect(evidence.integrity[0].integrity).toMatchObject({
      skipMarker: '@pytest.mark.skip(reason="later")',
    });
    expect(describeSuspiciousTests(evidence.integrity)[0].reasons).toEqual([
      'is marked as skipped (@pytest.mark.skip(reason="later"))',
    ]);
  });
});

describe('describeSuspiciousTests', () => {
  it('names emptied, assertion-free and disabled tests', async () => {
    const testRun = run([
      { testSuite: 'test_calculator', testName: 'test_add_returns_sum', status: 'PASSED' },
      { testSuite: 'test_calculator', testName: 'test_empty_body', status: 'PASSED' },
      { testSuite: 'test_calculator', testName: 'test_skipped_outright', status: 'SKIPPED' },
    ]);
    const { evidence } = await collect(testRun, PYTHON_FILES);

    expect(describeSuspiciousTests(evidence.integrity)).toEqual([
      { testSuite: 'test_calculator', testName: 'test_empty_body', reasons: ['has an empty body'] },
      {
        testSuite: 'test_calculator',
        testName: 'test_skipped_outright',
        reasons: ['is marked as skipped (@pytest.mark.skip(reason="not implemented yet"))'],
      },
    ]);
  });

  it('does not flag a framework-reported skip that has no skip marker', async () => {
    const testRun = run([
      { testSuite: 'test_calculator', testName: 'test_add_returns_sum', status: 'SKIPPED' },
    ]);
    const { evidence } = await collect(testRun, PYTHON_FILES);

    expect(describeSuspiciousTests(evidence.integrity)).toEqual([]);
  });

  it('stays quiet about unlocated tests when they are a small minority', async () => {
    const results: NormalizedTestCase[] = [
      { testSuite: 'test_calculator', testName: 'test_add_returns_sum', status: 'PASSED' },
      { testSuite: 'test_calculator', testName: 'test_async_add', status: 'PASSED' },
      { testSuite: 'test_calculator', testName: 'test_brace_in_a_string', status: 'PASSED' },
      { testSuite: 'nowhere', testName: 'test_missing', status: 'PASSED' },
    ];
    const testRun = run(results);
    const { evidence } = await collect(testRun, PYTHON_FILES);

    expect(describeSuspiciousTests(evidence.integrity)).toEqual([]);
  });

  it('reports unlocated tests once they dominate the run', async () => {
    const testRun = run([
      { testSuite: 'nowhere', testName: 'test_a', status: 'PASSED' },
      { testSuite: 'nowhere', testName: 'test_b', status: 'PASSED' },
    ]);
    const { evidence } = await collect(testRun, PYTHON_FILES);

    expect(describeSuspiciousTests(evidence.integrity).map((f) => f.reasons)).toEqual([
      ["could not be found in the project's source"],
      ["could not be found in the project's source"],
    ]);
  });
});
