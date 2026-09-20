import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestLocationResolver, parseStackFrames } from '../../../src/capture/location';

const ROOT = resolve('/work/proj');

/** Builds a resolver whose filesystem is exactly the given relative paths. */
function resolverFor(
  language: string,
  files: string[],
  dirs: string[] = [],
  root = ROOT,
): TestLocationResolver {
  const present = new Set(files.map((file) => resolve(root, file)));
  return new TestLocationResolver(root, language, {
    exists: async (path) => present.has(path),
    listDirs: async () => dirs,
  });
}

describe('parseStackFrames — JVM', () => {
  it('reads class, file and line, ignoring the module prefix', () => {
    const trace = [
      'java.lang.AssertionError: expected 2 but was 3',
      '\tat org.junit.Assert.fail(Assert.java:88)',
      '\tat app//com.pkg.FooTest.addsUp(FooTest.java:42)',
    ].join('\n');

    expect(parseStackFrames(trace, 'java')).toEqual([
      { className: 'org.junit.Assert', file: 'Assert.java', line: 88 },
      { className: 'com.pkg.FooTest', file: 'FooTest.java', line: 42 },
    ]);
  });

  it('skips frames with no source file', () => {
    const trace = '\tat java.base/java.lang.reflect.Method.invoke(Method.java:568)\n\tat Foo.bar(Unknown Source)';
    expect(parseStackFrames(trace, 'java')).toHaveLength(1);
  });
});

describe('parseStackFrames — python', () => {
  it('reads CPython traceback frames', () => {
    const trace = 'Traceback:\n  File "/work/proj/tests/test_math.py", line 12, in test_add\n    assert 1 == 2';
    expect(parseStackFrames(trace, 'python')).toEqual([
      { file: '/work/proj/tests/test_math.py', line: 12 },
    ]);
  });

  it("reads pytest's own report footer", () => {
    const trace = [
      'self = <test_math.TestMath object at 0x1>',
      '',
      '    def test_add(self):',
      '>       assert 1 == 2',
      'E       assert 1 == 2',
      '',
      'tests/test_math.py:12: AssertionError',
    ].join('\n');

    expect(parseStackFrames(trace, 'python')).toEqual([{ file: 'tests/test_math.py', line: 12 }]);
  });
});

describe('parseStackFrames — .NET', () => {
  it('reads the file and line after "in"', () => {
    const file = resolve(ROOT, 'FooTests.cs');
    const trace = `   at Ns.FooTests.Bar() in ${file}:line 42`;
    expect(parseStackFrames(trace, 'csharp')).toEqual([{ file, line: 42 }]);
  });
});

describe('resolveTestLocation', () => {
  it('maps a JVM frame to a maven test source root via the class name', async () => {
    const resolver = resolverFor('java', ['src/test/java/com/pkg/FooTest.java']);
    const trace = '\tat com.pkg.FooTest.addsUp(FooTest.java:42)';

    await expect(resolver.resolveTestLocation('com.pkg.FooTest', trace)).resolves.toEqual({
      file: resolve(ROOT, 'src/test/java/com/pkg/FooTest.java'),
      line: 42,
    });
  });

  it('prefers the frame belonging to the test suite over library frames', async () => {
    const resolver = resolverFor('java', [
      'src/test/java/com/pkg/FooTest.java',
      'src/main/java/com/pkg/Helper.java',
    ]);
    const trace = [
      '\tat com.pkg.Helper.check(Helper.java:7)',
      '\tat com.pkg.FooTest.addsUp(FooTest.java:42)',
    ].join('\n');

    await expect(resolver.resolveTestLocation('com.pkg.FooTest', trace)).resolves.toEqual({
      file: resolve(ROOT, 'src/test/java/com/pkg/FooTest.java'),
      line: 42,
    });
  });

  it('attributes a nested-class frame to its outer suite file', async () => {
    const resolver = resolverFor('java', ['src/test/java/com/pkg/FooTest.java']);
    const trace = '\tat com.pkg.FooTest$Inner.addsUp(FooTest.java:19)';

    await expect(resolver.resolveTestLocation('com.pkg.FooTest', trace)).resolves.toEqual({
      file: resolve(ROOT, 'src/test/java/com/pkg/FooTest.java'),
      line: 19,
    });
  });

  it('falls back to the first resolvable frame when none match the suite', async () => {
    const resolver = resolverFor('java', ['src/main/java/com/pkg/Helper.java']);
    const trace = [
      '\tat org.junit.Assert.fail(Assert.java:88)',
      '\tat com.pkg.Helper.check(Helper.java:7)',
    ].join('\n');

    await expect(resolver.resolveTestLocation('com.pkg.FooTest', trace)).resolves.toEqual({
      file: resolve(ROOT, 'src/main/java/com/pkg/Helper.java'),
      line: 7,
    });
  });

  it('finds sources in a multi-module layout', async () => {
    const resolver = resolverFor('java', ['core/src/test/java/com/pkg/FooTest.java'], ['core', 'web']);
    const trace = '\tat com.pkg.FooTest.addsUp(FooTest.java:42)';

    await expect(resolver.resolveTestLocation('com.pkg.FooTest', trace)).resolves.toEqual({
      file: resolve(ROOT, 'core/src/test/java/com/pkg/FooTest.java'),
      line: 42,
    });
  });

  it('resolves a pytest report footer relative to the folder', async () => {
    const resolver = resolverFor('python', ['tests/test_math.py']);
    const trace = 'tests/test_math.py:12: AssertionError';

    await expect(resolver.resolveTestLocation('tests.test_math.TestMath', trace)).resolves.toEqual({
      file: resolve(ROOT, 'tests/test_math.py'),
      line: 12,
    });
  });

  it('gives a passing test the suite file with no line', async () => {
    const resolver = resolverFor('java', ['src/test/java/com/pkg/FooTest.java']);

    await expect(resolver.resolveTestLocation('com.pkg.FooTest', undefined)).resolves.toEqual({
      file: resolve(ROOT, 'src/test/java/com/pkg/FooTest.java'),
    });
  });

  it('drops the class segment when deriving a pytest module file', async () => {
    const resolver = resolverFor('python', ['tests/test_math.py']);

    await expect(resolver.resolveTestLocation('tests.test_math.TestMath', undefined)).resolves.toEqual({
      file: resolve(ROOT, 'tests/test_math.py'),
    });
  });

  it('returns nothing when the suite has no matching file on disk', async () => {
    const resolver = resolverFor('java', []);

    await expect(resolver.resolveTestLocation('com.pkg.FooTest', undefined)).resolves.toBeUndefined();
  });

  it('reuses one filesystem probe across repeated lookups', async () => {
    let probes = 0;
    const present = new Set([resolve(ROOT, 'src/test/java/com/pkg/FooTest.java')]);
    const resolver = new TestLocationResolver(ROOT, 'java', {
      exists: async (path) => {
        probes += 1;
        return present.has(path);
      },
      listDirs: async () => [],
    });

    await resolver.resolveTestLocation('com.pkg.FooTest', undefined);
    const afterFirst = probes;
    await resolver.resolveTestLocation('com.pkg.FooTest', undefined);

    expect(probes).toBe(afterFirst);
  });
});
