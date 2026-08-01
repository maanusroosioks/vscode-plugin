import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTrx } from '../../../../src/adapters/parsers/trx-parser';

describe('parseTrx', () => {
  it('parses a .trx report, mapping outcomes and joining test names to their class via TestDefinitions', async () => {
    const xml = await readFile(join(__dirname, '../../fixtures/dotnet/sample-results.trx'), 'utf8');
    const results = parseTrx(xml);

    expect(results).toHaveLength(3);

    const passed = results.find((r) => r.testName === 'AddsTwoNumbers');
    expect(passed).toMatchObject({
      status: 'PASSED',
      testSuite: 'Calculator.Tests.CalculatorTests',
      durationMs: 1,
    });

    const failed = results.find((r) => r.testName === 'DividesByZero');
    expect(failed?.status).toBe('FAILED');
    expect(failed?.message).toContain('Assert.Throws');
    expect(failed?.stackTrace).toContain('CalculatorTests.cs');

    const skipped = results.find((r) => r.testName === 'NotReadyYet');
    expect(skipped?.status).toBe('SKIPPED');
  });
});
