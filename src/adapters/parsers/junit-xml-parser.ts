import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { NormalizedTestCase, TestStatus } from '../../core/types';
import { removeDir } from '../../util/shell';
import { parseReportFile } from './report-file';

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
  return Number.isFinite(value) ? Math.round(value * 1000) : undefined;
}

function firstOf<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function extractFailure(node: JUnitFailureXml | JUnitFailureXml[] | string | undefined): {
  message?: string;
  stackTrace?: string;
} {
  // Several <failure> elements can appear; the first is the one that aborted the test.
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
      // pytest names every suite "pytest"; only the case carries the owning module.
      testSuite: testcase['@_classname'] ?? suite['@_name'],
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
  // fast-xml-parser doesn't throw on garbage, so an empty file would otherwise
  // read as a run with no tests.
  if (doc.testsuites === undefined && doc.testsuite === undefined) {
    throw new Error('no <testsuite> element found — this is not a JUnit XML report');
  }
  const suites: JUnitTestSuiteXml[] = doc.testsuites?.testsuite ?? doc.testsuite ?? [];

  const results: NormalizedTestCase[] = [];
  for (const suite of suites) {
    collectSuite(suite, results);
  }
  return results;
}

export function parseJUnitXmlFile(path: string): Promise<NormalizedTestCase[]> {
  return parseReportFile(path, parseJUnitXml);
}

/** Some filesystems round mtime down to whole seconds; don't discard fresh reports over it. */
const STALE_SLACK_MS = 2000;

/** Large or irrelevant trees that never contain report directories. */
const PRUNE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  'node_modules',
  'src',
  'bin',
  'obj',
  'classes',
  'test-classes',
  'generated-sources',
  'generated-test-sources',
  'maven-status',
  'maven-archiver',
]);

export interface CollectReportsOptions {
  /**
   * Only use files in a directory whose trailing path segments match this, e.g.
   * `surefire-reports` or `build/test-results/test`. Unset means any directory.
   */
  reportDir?: string;
  /** Ignore report files last modified before this timestamp (see {@link STALE_SLACK_MS}). */
  since?: number;
  /** Called per unusable report file; the rest are still parsed. */
  onWarning?(message: string): void;
}

interface ScannedDir {
  dir: string;
  entries: Dirent[];
}

function segmentsOf(reportDir: string | undefined): string[] {
  return reportDir === undefined ? [] : reportDir.split(/[\\/]/).filter(Boolean);
}

function endsWithSegments(dir: string, suffix: string[]): boolean {
  if (suffix.length === 0) return true;
  const segments = dir.split(sep).filter(Boolean);
  const offset = segments.length - suffix.length;
  return offset >= 0 && suffix.every((want, i) => segments[offset + i] === want);
}

function isWalkable(entry: Dirent): boolean {
  // `isDirectory()` is false for symlinks, so the walk cannot loop.
  return entry.isDirectory() && !entry.name.startsWith('.') && !PRUNE_DIRS.has(entry.name);
}

/** Every readable directory at or under `root`, in a stable order. */
async function scanTree(root: string, into: ScannedDir[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  into.push({ dir: root, entries });

  const subdirs = entries
    .filter(isWalkable)
    .map((entry) => entry.name)
    .sort();
  for (const name of subdirs) {
    await scanTree(join(root, name), into);
  }
}

async function findReportDirs(root: string, suffix: string[]): Promise<ScannedDir[]> {
  const scanned: ScannedDir[] = [];
  await scanTree(root, scanned);
  return scanned.filter(({ dir }) => endsWithSegments(dir, suffix));
}

async function isFresh(path: string, since?: number): Promise<boolean> {
  if (since === undefined) return true;
  try {
    return (await stat(path)).mtimeMs >= since - STALE_SLACK_MS;
  } catch {
    return false;
  }
}

/** Clears previous results. Walks rather than taking a fixed path: one dir per module. */
export async function clearReportDirs(root: string, reportDir: string): Promise<void> {
  const suffix = segmentsOf(reportDir);
  if (suffix.length === 0) {
    throw new Error('clearReportDirs needs a directory to match; refusing to clear the whole tree.');
  }
  const dirs = await findReportDirs(root, suffix);
  await Promise.all(dirs.map(({ dir }) => removeDir(dir)));
}

export async function parseJUnitXmlDirectory(
  root: string,
  opts: CollectReportsOptions = {},
): Promise<NormalizedTestCase[]> {
  const dirs = await findReportDirs(root, segmentsOf(opts.reportDir));
  const files = dirs.flatMap(({ dir, entries }) =>
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.xml'))
      .map((entry) => join(dir, entry.name))
      .sort(),
  );

  const perFile = await Promise.all(
    files.map(async (path) => {
      if (!(await isFresh(path, opts.since))) return [];
      try {
        return await parseJUnitXmlFile(path);
      } catch (error) {
        opts.onWarning?.(error instanceof Error ? error.message : String(error));
        return [];
      }
    }),
  );
  return perFile.flat();
}
