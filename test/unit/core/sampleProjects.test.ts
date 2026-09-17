// End-to-end over the real sample projects: real filesystem, real resolver, no mocks.
// Skipped when the samples aren't checked out beside the extension (e.g. on CI).

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTestRunRequest } from '../../../src/core/payload';
import { TestLocationResolver } from '../../../src/core/testLocation';
import {
  collectTestEvidence,
  describeSuspiciousTests,
  type TestEvidence,
} from '../../../src/core/testEvidence';
import type { NormalizedTestCase, NormalizedTestRun } from '../../../src/core/types';

const EXAMPLES = resolve('c:/Moodle/examples');

const metadata = { assignmentKey: 'sample-assignment', projectName: 'sample' };

async function evidenceFor(folder: string, run: NormalizedTestRun): Promise<TestEvidence> {
  return collectTestEvidence(run, new TestLocationResolver(folder, run.language), {
    folderPath: folder,
    captureSource: true,
    maxTestChars: 8000,
    maxTotalChars: 200000,
  });
}

function run(
  adapterId: string,
  language: string,
  results: NormalizedTestCase[],
): NormalizedTestRun {
  return { adapterId, language, startedAt: 1000, finishedAt: 2000, results };
}

function codeFor(evidence: TestEvidence, index: number): string {
  const source = evidence.entries[index].source;
  expect(source.kind).toBe('TEST');
  return source.code as string;
}

function located(evidence: TestEvidence): number {
  return evidence.entries.filter((entry) => entry.integrity.located).length;
}

const pythonSample = resolve(EXAMPLES, 'python-sample');
const mavenSample = resolve(EXAMPLES, 'java-maven-sample');
const gradleSample = resolve(EXAMPLES, 'java-gradle-sample');
const dotnetSample = resolve(EXAMPLES, 'dotnet-sample');

describe.skipIf(!existsSync(pythonSample))('python-sample', () => {
  const testRun = run('pytest', 'python', [
    { testSuite: 'test_calculator', testName: 'test_add_returns_sum', status: 'PASSED' },
    { testSuite: 'test_calculator', testName: 'test_divide_returns_quotient[10-2-5]', status: 'PASSED' },
    { testSuite: 'test_calculator', testName: 'test_divide_returns_quotient[9-3-3]', status: 'PASSED' },
    { testSuite: 'test_calculator', testName: 'test_divide_by_zero_raises', status: 'PASSED' },
    {
      testSuite: 'test_calculator',
      testName: 'test_multiply_returns_product_intentionally_failing',
      status: 'FAILED',
      message: 'assert 9 == 99',
      stackTrace: 'test_calculator.py:27: AssertionError',
    },
  ]);

  it('locates every test and captures its own source', async () => {
    const evidence = await evidenceFor(pythonSample, testRun);

    expect(located(evidence)).toBe(5);
    expect(evidence.entries.every((entry) => entry.source.kind === 'TEST')).toBe(true);
    expect(evidence.entries.every((entry) => entry.source.filePath === 'test_calculator.py')).toBe(true);
  });

  it('maps both parametrized ids onto the same declaration, decorator included', async () => {
    const evidence = await evidenceFor(pythonSample, testRun);

    expect(codeFor(evidence, 1)).toContain('@pytest.mark.parametrize');
    expect(codeFor(evidence, 1)).toContain('assert divide(a, b) == expected');
    expect(evidence.entries[1].source.normalizedCodeHash).toBe(
      evidence.entries[2].source.normalizedCodeHash,
    );
    expect(codeFor(evidence, 1)).not.toContain('def test_divide_by_zero_raises');
  });

  it('counts assertions and finds nothing suspicious', async () => {
    const evidence = await evidenceFor(pythonSample, testRun);

    expect(describeSuspiciousTests(evidence, testRun)).toEqual([]);
    expect(evidence.entries.every((entry) => (entry.integrity.assertionCount ?? 0) > 0)).toBe(true);
  });
});

describe.skipIf(!existsSync(mavenSample) || !existsSync(gradleSample))('java samples', () => {
  const testRun = run('maven-junit', 'java', [
    { testSuite: 'com.example.calculator.CalculatorTest', testName: 'addReturnsSum()', status: 'PASSED' },
    {
      testSuite: 'com.example.calculator.CalculatorTest',
      testName: 'divideReturnsQuotient(int, int, int)[1]',
      status: 'PASSED',
    },
    {
      testSuite: 'com.example.calculator.CalculatorTest',
      testName: 'divideByZeroThrows()',
      status: 'PASSED',
    },
  ]);

  it.each([
    ['maven', mavenSample],
    ['gradle', gradleSample],
  ])('%s: resolves tests under src/test/java and captures them', async (_name, folder) => {
    const evidence = await evidenceFor(folder, testRun);

    expect(located(evidence)).toBe(3);
    expect(evidence.entries[0].source.filePath).toBe(
      'src/test/java/com/example/calculator/CalculatorTest.java',
    );
    expect(codeFor(evidence, 0)).toContain('assertEquals(5, Calculator.add(2, 3));');
    expect(codeFor(evidence, 1)).toContain('@ParameterizedTest');
    expect(codeFor(evidence, 1)).toContain('@CsvSource({"10, 2, 5", "9, 3, 3"})');
    expect(codeFor(evidence, 2)).toContain('assertThrows(ArithmeticException.class');
  });
});

describe.skipIf(!existsSync(dotnetSample))('dotnet-sample', () => {
  const suite = 'CalculatorSample.Tests.CalculatorTests';
  const testRun = run('dotnet-test', 'csharp', [
    { testSuite: suite, testName: `${suite}.Add_ReturnsSum`, status: 'PASSED' },
    {
      testSuite: suite,
      testName: `${suite}.Divide_ReturnsQuotient(a: 10, b: 2, expected: 5)`,
      status: 'PASSED',
    },
    { testSuite: suite, testName: `${suite}.Divide_ByZero_Throws`, status: 'PASSED' },
  ]);

  it('captures tests from a file-scoped namespace', async () => {
    const evidence = await evidenceFor(dotnetSample, testRun);

    expect(located(evidence)).toBe(3);
    expect(evidence.entries[0].source.filePath).toBe('CalculatorTests.cs');
    expect(codeFor(evidence, 1)).toContain('[Theory]');
    expect(codeFor(evidence, 1)).toContain('[InlineData(10, 2, 5)]');
    expect(codeFor(evidence, 1)).toContain('[InlineData(9, 3, 3)]');
  });

  it('keeps angle brackets in generic assertions all the way through the payload', async () => {
    const evidence = await evidenceFor(dotnetSample, testRun);
    const request = buildTestRunRequest(testRun, metadata, evidence);

    // Sanitized for Moodle PARAM_TEXT, but the captured code must survive verbatim.
    expect(request.results[2].source?.code).toContain('Assert.Throws<DivideByZeroException>');
    expect(request.results[2].source?.normalizedCodeHash).toHaveLength(64);
    expect(request).not.toHaveProperty('integrity');
  });
});
