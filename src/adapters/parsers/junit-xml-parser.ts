import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { NormalizedTestCase, TestStatus } from '../../core/types';

interface JUnitFailureXml {
  '@_message'?: string;
  '#text'?: string;
}

interface JUnitTestCaseXml {
  '@_classname'?: string;
  '@_name': string;
  '@_time'?: string;
  failure?: JUnitFailureXml | JUnitFailureXml[] | string;
  error?: JUnitFailureXml | JUnitFailureXml[] | string;
  skipped?: unknown;
}

interface JUnitTestSuiteXml {
  '@_name'?: string;
  testcase?: JUnitTestCaseXml[];
  testsuite?: JUnitTestSuiteXml[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => name === 'testsuite' || name === 'testcase',
});

function toMillis(seconds?: string): number | undefined {
  if (seconds === undefined) return undefined;
  const value = Number.parseFloat(seconds);
  return Number.isNaN(value) ? undefined : Math.round(value * 1000);
}

function firstOf<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function extractFailure(node: JUnitFailureXml | JUnitFailureXml[] | string | undefined): {
  message?: string;
  stackTrace?: string;
} {
  const failure = firstOf(node);
  if (failure === undefined) return {};
  if (typeof failure === 'string') return { stackTrace: failure };
  return { message: failure['@_message'], stackTrace: failure['#text'] };
}

function collectSuite(suite: JUnitTestSuiteXml, into: NormalizedTestCase[]): void {
  for (const testcase of suite.testcase ?? []) {
    let status: TestStatus = 'PASSED';
    let message: string | undefined;
    let stackTrace: string | undefined;

    if (testcase.failure !== undefined) {
      status = 'FAILED';
      ({ message, stackTrace } = extractFailure(testcase.failure));
    } else if (testcase.error !== undefined) {
      status = 'ERROR';
      ({ message, stackTrace } = extractFailure(testcase.error));
    } else if (testcase.skipped !== undefined) {
      status = 'SKIPPED';
    }

    into.push({
      testSuite: suite['@_name'],
      testName: testcase['@_name'],
      status,
      durationMs: toMillis(testcase['@_time']),
      message,
      stackTrace,
    });
  }

  // JUnit 5 aggregated reports can nest <testsuite> elements; recurse so their
  // cases aren't silently dropped.
  for (const nested of suite.testsuite ?? []) {
    collectSuite(nested, into);
  }
}

export function parseJUnitXml(xml: string): NormalizedTestCase[] {
  const doc = parser.parse(xml);
  const suites: JUnitTestSuiteXml[] = doc.testsuites?.testsuite ?? doc.testsuite ?? [];

  const results: NormalizedTestCase[] = [];
  for (const suite of suites) {
    collectSuite(suite, results);
  }
  return results;
}


const STALE_SLACK_MS = 2000;


const PRUNE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'src',
  '.idea',
  '.vscode',
  'bin',
  'obj',
  // Build output that can be large but never holds JUnit XML.
  'classes',
  'test-classes',
  'generated-sources',
  'generated-test-sources',
  'maven-status',
  'maven-archiver',
]);

export interface CollectReportsOptions {
  /** Only parse files whose containing directory has exactly this basename. */
  dirName?: string;
  /** Ignore report files last modified before this timestamp (see {@link STALE_SLACK_MS}). */
  since?: number;
}

async function walkXmlFiles(dir: string, opts: CollectReportsOptions, into: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const inTargetDir = opts.dirName === undefined || basename(dir) === opts.dirName;
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!PRUNE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await walkXmlFiles(full, opts, into);
      }
    } else if (inTargetDir && entry.name.endsWith('.xml')) {
      into.push(full);
    }
  }
}

async function isFresh(path: string, since?: number): Promise<boolean> {
  if (since === undefined) return true;
  try {
    return (await stat(path)).mtimeMs >= since - STALE_SLACK_MS;
  } catch {
    return false;
  }
}

export async function parseJUnitXmlDirectory(
  dir: string,
  opts: CollectReportsOptions = {},
): Promise<NormalizedTestCase[]> {
  const files: string[] = [];
  await walkXmlFiles(dir, opts, files);

  const results: NormalizedTestCase[] = [];
  for (const path of files) {
    if (await isFresh(path, opts.since)) {
      results.push(...parseJUnitXml(await readFile(path, 'utf8')));
    }
  }
  return results;
}
