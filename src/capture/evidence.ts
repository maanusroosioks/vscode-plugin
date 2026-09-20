// The UI layer hands in an already-constructed TestLocationResolver.

import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, sep } from 'node:path';
import { sha256Hex } from './hash';
import type { TestLocationResolver } from './location';
import { analyzeDeclaration, unlocatedIntegrity, type TestIntegrity } from './integrity';
import {
  languageForFile,
  matchDeclaration,
  normalizeCode,
  scanTestDeclarations,
  sliceLines,
  type SourceLanguage,
  type TestDeclaration,
} from '../source';
import type { NormalizedTestRun } from '../core/types';

/** Workspace-relative, forward slashes — never absolute, which would leak the student's username. */
type RelativePath = string;

/** Nothing was found: no file, so no hash either. */
export interface UnlocatedSource {
  kind: 'NONE';
}

/** The file was found but the test could not be picked out of it, so the hash covers the whole file. */
export interface FileSource {
  kind: 'FILE';
  filePath: RelativePath;
  normalizedCodeHash: string;
}

export interface DeclaredSource {
  kind: 'TEST';
  filePath: RelativePath;
  /** 1-based, in the original file. The primary way to read this test: slice the range out of its file. */
  startLine: number;
  endLine: number;
  /** Fallback only, for when the file in `files` does not carry `endLine` — see `collectTestEvidence`. */
  code?: string;
  truncated?: boolean;
  /** Always over the UNtruncated snippet, so a cap never breaks a run-to-run comparison. */
  normalizedCodeHash: string;
}

/**
 * `kind` is the tag, not a summary: it says which fields are there and, with them, what
 * `normalizedCodeHash` covers — a whole file and a single declaration are never comparable.
 */
export type TestSource = UnlocatedSource | FileSource | DeclaredSource;

export interface TestSourceFile {
  /** Workspace-relative, forward slashes. The join key from `TestSource.filePath`. */
  path: string;
  sha256: string;
  /** Absent when capture is off or the per-submission budget ran out. */
  content?: string;
  truncated?: boolean;
}

/** The half bound for the grader. Everything the payload builder is allowed to see. */
export interface TestEvidencePayload {
  /** Index-aligned with `run.results`. */
  sources: TestSource[];
  /** Each distinct test file once, and the source every located test is read from. */
  files: TestSourceFile[];
  /** Set only when the student switched source capture off. */
  captureDisabled?: boolean;
  /** Set only when the student was shown the pre-submit warning and chose to submit anyway. */
  warningAcknowledged?: boolean;
}

/** Names its own test, so the warning path never indexes back into the run to find out whose it is. */
export interface TestIntegrityEntry {
  testSuite?: string;
  testName: string;
  integrity: TestIntegrity;
}

export interface TestEvidence {
  payload: TestEvidencePayload;
  /** Local only — feeds the pre-submit warning. Unreachable from `payload`, so it cannot be sent. */
  integrity: TestIntegrityEntry[];
}

export interface CaptureOptions {
  folderPath: string;
  captureSource: boolean;
  maxTestChars: number;
  maxTotalChars: number;
  readFile?: (path: string) => Promise<string>;
}

export interface SuspiciousTest {
  testSuite?: string;
  testName: string;
  reasons: string[];
}

interface SourceFile {
  relativePath: string;
  text: string;
  hash: string;
  language?: SourceLanguage;
  declarations: TestDeclaration[];
  /** Memoised: every unmatched result in this file would otherwise recompute it. */
  normalizedHash?: string;
}

function snippetOf(file: SourceFile, declaration: TestDeclaration): string {
  return sliceLines(file.text, declaration.startLine, declaration.endLine);
}

function fileCodeHash(file: SourceFile): string {
  file.normalizedHash ??= sha256Hex(normalizeCode(file.text, file.language));
  return file.normalizedHash;
}

/** Below this share of unlocatable tests it's an unusual project layout, not a signal. */
const UNLOCATED_SHARE = 0.3;

function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function toRelative(folderPath: string, absolutePath: string): string {
  const path = relative(folderPath, absolutePath);
  if (!path || path.startsWith('..') || isAbsolute(path)) {
    return basename(absolutePath);
  }
  return path.split(sep).join('/');
}

function truncationNotice(removed: number): string {
  return `\n… [truncated by moodle-test-submit: ${removed} more characters]`;
}

/** The notice outruns a short snippet, so it is reserved from the budget rather than the cap. */
function noticeReserve(code: string): number {
  return truncationNotice(code.length).length;
}

function capCode(code: string, limit: number): { code: string; truncated: boolean; kept: number } {
  if (code.length <= limit) return { code, truncated: false, kept: code.length };
  const removed = code.length - limit;
  return { code: `${code.slice(0, limit)}${truncationNotice(removed)}`, truncated: true, kept: limit };
}

/** Complete lines inside the first `kept` characters: a cut lands mid-line, and that line does not count. */
function linesRetained(text: string, kept: number): number {
  if (kept >= text.length) return Number.POSITIVE_INFINITY;
  let count = 0;
  for (let index = text.indexOf('\n'); index !== -1 && index < kept; index = text.indexOf('\n', index + 1)) {
    count += 1;
  }
  return count;
}

/** A located test, held over until the files are charged — its snippet is sent only if its file misses it. */
interface SnippetCandidate {
  source: DeclaredSource;
  file: SourceFile;
  declaration: TestDeclaration;
}

/**
 * Held back from a file's own content so a file too large for the budget still leaves room for the
 * snippets that have to stand in for the lines it drops. Never spent unless those snippets are.
 */
function snippetReserve(candidates: SnippetCandidate[] | undefined, maxTestChars: number): number {
  let total = 0;
  for (const candidate of candidates ?? []) {
    const snippet = snippetOf(candidate.file, candidate.declaration);
    total += Math.min(maxTestChars, snippet.length) + noticeReserve(snippet);
  }
  return total;
}

export async function collectTestEvidence(
  run: NormalizedTestRun,
  resolver: TestLocationResolver,
  options: CaptureOptions,
): Promise<TestEvidence> {
  const read = options.readFile ?? ((path: string): Promise<string> => readFile(path, 'utf8'));
  const loaded = new Map<string, SourceFile | undefined>();
  const sources: TestSource[] = [];
  const integrity: TestIntegrityEntry[] = [];
  const candidates = new Map<SourceFile, SnippetCandidate[]>();
  let budget = Math.max(0, options.maxTotalChars);

  // One read and one scan per file per run, however many of its tests ran.
  const loadFile = async (absolutePath: string): Promise<SourceFile | undefined> => {
    if (loaded.has(absolutePath)) return loaded.get(absolutePath);

    let file: SourceFile | undefined;
    try {
      const text = toLf(await read(absolutePath));
      const language = languageForFile(absolutePath, run.language);
      file = {
        relativePath: toRelative(options.folderPath, absolutePath),
        text,
        hash: sha256Hex(text),
        language,
        declarations: language ? scanTestDeclarations(text, language) : [],
      };
    } catch {
      file = undefined;
    }
    loaded.set(absolutePath, file);
    return file;
  };

  for (const testCase of run.results) {
    const record = (source: TestSource, signals: TestIntegrity): void => {
      sources.push(source);
      integrity.push({ testSuite: testCase.testSuite, testName: testCase.testName, integrity: signals });
    };

    const location = await resolver.resolveTestLocation(testCase.testSuite, testCase.stackTrace);
    const file = location ? await loadFile(location.file) : undefined;
    if (!file) {
      record({ kind: 'NONE' }, unlocatedIntegrity());
      continue;
    }

    // An unknown language means nothing was scanned, so there is nothing to match against.
    const language = file.language;
    let declaration: TestDeclaration | undefined;
    let signals = unlocatedIntegrity();
    if (language) {
      declaration = matchDeclaration(file.declarations, testCase.testName, testCase.testSuite, location?.line);
      if (declaration) signals = analyzeDeclaration(declaration, language);
    }

    if (!declaration) {
      record(
        { kind: 'FILE', filePath: file.relativePath, normalizedCodeHash: fileCodeHash(file) },
        signals,
      );
      continue;
    }

    const source: DeclaredSource = {
      kind: 'TEST',
      filePath: file.relativePath,
      startLine: declaration.startLine,
      endLine: declaration.endLine,
      // Keeps its meaning without the code, so the budget never drops it.
      normalizedCodeHash: sha256Hex(normalizeCode(snippetOf(file, declaration), file.language)),
    };

    // Deferred: whether this snippet is needed at all depends on how much of its file survives the
    // budget, and that is not known until every file has been seen.
    if (options.captureSource) {
      const pending = candidates.get(file) ?? [];
      pending.push({ source, file, declaration });
      candidates.set(file, pending);
    }

    record(source, signals);
  }

  // Charged before the snippets: a test whose file is sent whole is read from there by line number,
  // so sending its snippet as well would be the same bytes twice.
  const files: TestSourceFile[] = [];
  const retained = new Map<SourceFile, number>();
  for (const file of loaded.values()) {
    if (!file) continue;
    const entry: TestSourceFile = { path: file.relativePath, sha256: file.hash };
    const reserve = snippetReserve(candidates.get(file), options.maxTestChars);
    const room = budget - reserve - noticeReserve(file.text);
    if (options.captureSource && room > 0) {
      const capped = capCode(file.text, room);
      entry.content = capped.code;
      if (capped.truncated) entry.truncated = true;
      budget -= capped.code.length;
      retained.set(file, linesRetained(file.text, capped.kept));
    }
    files.push(entry);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  // Only the tests their own file failed to carry — the rest are sliced out of `files` by line number.
  for (const [file, pending] of candidates) {
    const covered = retained.get(file) ?? 0;
    for (const { source, declaration } of pending) {
      if (declaration.endLine <= covered) continue;
      const snippet = snippetOf(file, declaration);
      const room = budget - noticeReserve(snippet);
      if (room <= 0) continue;
      const capped = capCode(snippet, Math.min(options.maxTestChars, room));
      source.code = capped.code;
      if (capped.truncated) source.truncated = true;
      budget -= capped.code.length;
    }
  }

  return {
    payload: { sources, files, captureDisabled: options.captureSource ? undefined : true },
    integrity,
  };
}

/**
 * A framework-reported SKIPPED status is deliberately not a reason on its own: it is legitimate
 * and already visible in the results, and warning on it would train students to click through.
 */
export function describeSuspiciousTests(entries: TestIntegrityEntry[]): SuspiciousTest[] {
  const total = entries.length;
  const unlocated = entries.filter((entry) => !entry.integrity.located).length;
  const reportUnlocated = total > 0 && unlocated / total > UNLOCATED_SHARE;
  const findings: SuspiciousTest[] = [];

  for (const { testSuite, testName, integrity } of entries) {
    const reasons: string[] = [];
    if (integrity.empty) {
      reasons.push('has an empty body');
    } else if (integrity.located && integrity.assertionCount === 0) {
      reasons.push('makes no assertions');
    }
    if (integrity.skipMarker) {
      reasons.push(`is marked as skipped (${integrity.skipMarker})`);
    }
    if (!integrity.located && reportUnlocated) {
      reasons.push("could not be found in the project's source");
    }

    if (reasons.length > 0) {
      findings.push({ testSuite, testName, reasons });
    }
  }

  return findings;
}
