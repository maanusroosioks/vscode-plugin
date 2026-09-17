// Free of `vscode` imports: the UI layer hands in an already-constructed TestLocationResolver.

import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, sep } from 'node:path';
import { sha256Hex } from './stackTraceHash';
import type { TestLocationResolver } from './testLocation';
import { analyzeDeclaration, unlocatedIntegrity, type TestIntegrity } from './testIntegrity';
import {
  languageForFile,
  matchDeclaration,
  normalizeCode,
  scanTestDeclarations,
  sliceLines,
  type SourceLanguage,
  type TestDeclaration,
} from './testSource';
import type { NormalizedTestRun, TestSourceKind } from './types';

export interface TestSource {
  kind: TestSourceKind;
  /** Workspace-relative, forward slashes — never absolute, which would leak the student's username. */
  filePath?: string;
  startLine?: number;
  endLine?: number;
  code?: string;
  truncated?: boolean;
  /** Always over the UNtruncated snippet, so a cap never breaks a run-to-run comparison. */
  normalizedCodeHash?: string;
}

export interface TestSourceFile {
  /** Workspace-relative, forward slashes. The join key from `TestSource.filePath`. */
  path: string;
  sha256: string;
  /** Absent when capture is off or the per-submission budget ran out. */
  content?: string;
  truncated?: boolean;
}

export interface TestEvidenceEntry {
  source: TestSource;
  /** Local only — feeds the pre-submit warning. Deliberately not part of the payload. */
  integrity: TestIntegrity;
}

export interface TestEvidence {
  /** Index-aligned with `run.results`. */
  entries: TestEvidenceEntry[];
  /** Each distinct test file once, so a FILE-kind result costs one copy rather than one each. */
  files: TestSourceFile[];
  /** Set only when the student switched source capture off. */
  captureDisabled?: boolean;
  /** Set only when the student was shown the pre-submit warning and chose to submit anyway. */
  warningAcknowledged?: boolean;
}

export interface CollectEvidenceOptions {
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

function capCode(code: string, limit: number): { code: string; truncated: boolean } {
  if (code.length <= limit) return { code, truncated: false };
  const removed = code.length - limit;
  return {
    code: `${code.slice(0, limit)}\n… [truncated by moodle-test-submit: ${removed} more characters]`,
    truncated: true,
  };
}

export async function collectTestEvidence(
  run: NormalizedTestRun,
  resolver: TestLocationResolver,
  options: CollectEvidenceOptions,
): Promise<TestEvidence> {
  const read = options.readFile ?? ((path: string): Promise<string> => readFile(path, 'utf8'));
  const loaded = new Map<string, SourceFile | undefined>();
  const entries: TestEvidenceEntry[] = [];
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
    const location = await resolver.resolveTestLocation(testCase.testSuite, testCase.stackTrace);
    const file = location ? await loadFile(location.file) : undefined;
    if (!file) {
      entries.push({ source: { kind: 'NONE' }, integrity: unlocatedIntegrity() });
      continue;
    }

    // An unknown language leaves `declarations` empty, which matchDeclaration already handles.
    const declaration = matchDeclaration(
      file.declarations,
      testCase.testName,
      testCase.testSuite,
      location?.line,
    );
    const integrity =
      declaration && file.language
        ? analyzeDeclaration(declaration, file.language)
        : unlocatedIntegrity();

    const source: TestSource = {
      kind: declaration ? 'TEST' : 'FILE',
      filePath: file.relativePath,
      startLine: declaration?.startLine,
      endLine: declaration?.endLine,
      // Keeps its meaning without the code, so the budget never drops it.
      normalizedCodeHash: declaration
        ? sha256Hex(normalizeCode(snippetOf(file, declaration), file.language))
        : fileCodeHash(file),
    };

    // A FILE-kind result carries no code of its own: the file is in `files`, charged once.
    if (options.captureSource && budget > 0 && declaration) {
      const capped = capCode(snippetOf(file, declaration), Math.min(options.maxTestChars, budget));
      source.code = capped.code;
      if (capped.truncated) source.truncated = true;
      budget -= capped.code.length;
    }

    entries.push({ source, integrity });
  }

  // Charged after the snippets, so a pathological project still gets its per-result view.
  const files: TestSourceFile[] = [];
  for (const file of loaded.values()) {
    if (!file) continue;
    const entry: TestSourceFile = { path: file.relativePath, sha256: file.hash };
    if (options.captureSource && budget > 0) {
      const capped = capCode(file.text, budget);
      entry.content = capped.code;
      if (capped.truncated) entry.truncated = true;
      budget -= capped.code.length;
    }
    files.push(entry);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  return { entries, files, captureDisabled: options.captureSource ? undefined : true };
}

/**
 * A framework-reported SKIPPED status is deliberately not a reason on its own: it is legitimate
 * and already visible in the results, and warning on it would train students to click through.
 */
export function describeSuspiciousTests(
  evidence: TestEvidence,
  run: NormalizedTestRun,
): SuspiciousTest[] {
  const total = run.results.length;
  const unlocated = evidence.entries.filter((entry) => !entry.integrity.located).length;
  const reportUnlocated = total > 0 && unlocated / total > UNLOCATED_SHARE;
  const findings: SuspiciousTest[] = [];

  run.results.forEach((testCase, index) => {
    const integrity = evidence.entries[index]?.integrity;
    if (!integrity) return;

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
      findings.push({ testSuite: testCase.testSuite, testName: testCase.testName, reasons });
    }
  });

  return findings;
}
