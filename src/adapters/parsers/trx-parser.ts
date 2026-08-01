import { XMLParser } from 'fast-xml-parser';
import type { NormalizedTestCase, TestStatus } from '../../core/types';

interface TrxErrorInfo {
  Message?: string;
  StackTrace?: string;
}

interface TrxUnitTestResult {
  '@_testId': string;
  '@_testName': string;
  '@_outcome': string;
  '@_duration'?: string;
  Output?: {
    ErrorInfo?: TrxErrorInfo;
  };
}

interface TrxUnitTest {
  '@_id': string;
  TestMethod?: { '@_className'?: string; '@_name'?: string };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => name === 'UnitTestResult' || name === 'UnitTest',
});

function parseTrxDuration(duration?: string): number | undefined {
  if (!duration) return undefined;
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(duration);
  if (!match) return undefined;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Math.round(Number(seconds) * 1000);
}

function mapOutcome(outcome: string): TestStatus {
  switch (outcome) {
    case 'Passed':
      return 'PASSED';
    case 'Failed':
      return 'FAILED';
    case 'NotExecuted':
      return 'SKIPPED';
    default:
      return 'ERROR';
  }
}

export function parseTrx(xml: string): NormalizedTestCase[] {
  const doc = parser.parse(xml);
  const testRun = doc.TestRun ?? {};
  const results: TrxUnitTestResult[] = testRun.Results?.UnitTestResult ?? [];
  const definitions: TrxUnitTest[] = testRun.TestDefinitions?.UnitTest ?? [];

  const classNameById = new Map<string, string | undefined>();
  for (const definition of definitions) {
    classNameById.set(definition['@_id'], definition.TestMethod?.['@_className']);
  }

  return results.map((result) => {
    const errorInfo = result.Output?.ErrorInfo;
    return {
      testSuite: classNameById.get(result['@_testId']),
      testName: result['@_testName'],
      status: mapOutcome(result['@_outcome']),
      durationMs: parseTrxDuration(result['@_duration']),
      message: errorInfo?.Message,
      stackTrace: errorInfo?.StackTrace,
    };
  });
}
