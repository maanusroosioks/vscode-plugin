// Free of `vscode` imports so this stays unit-testable without a vscode mock.
import { readdir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathExists } from '../util/shell';

export interface SourceLocation {
  file: string;
  /** 1-based. Absent when only the file is known. */
  line?: number;
}

export interface StackFrame {
  className?: string;
  file: string;
  line: number;
}

export type ExistsFn = (path: string) => Promise<boolean>;
export type ListDirsFn = (path: string) => Promise<string[]>;

const SOURCE_EXTENSIONS: Record<string, string[]> = {
  java: ['.java', '.kt', '.kts', '.scala', '.groovy'],
  python: ['.py'],
  csharp: ['.cs'],
};

const SOURCE_ROOTS: Record<string, string[]> = {
  java: [
    'src/test/java',
    'src/main/java',
    'src/test/kotlin',
    'src/main/kotlin',
    'src/test/scala',
    'src/main/scala',
    'src',
    '',
  ],
  python: ['', 'src', 'tests', 'test'],
  csharp: ['', 'src'],
};

const DEFAULT_ROOTS = ['', 'src'];

const IGNORED_DIRS = new Set([
  'node_modules',
  'target',
  'build',
  'bin',
  'obj',
  'out',
  'dist',
  'venv',
  '.venv',
  '__pycache__',
  'site-packages',
]);

/** `at app//com.pkg.FooTest.bar(FooTest.java:42)` — the `app//` prefix is optional. */
const JVM_FRAME = /\bat\s+([^\s(]+)\(([^()]+):(\d+)\)/g;
/** CPython traceback: `File "/abs/tests/test_x.py", line 12, in test_bar`. */
const PYTHON_TRACEBACK_FRAME = /File "([^"]+)", line (\d+)/g;
/** pytest's own failure report footer: `tests/test_math.py:12: AssertionError`. */
const PYTEST_REPORT_FRAME = /^\s*([^\s:][^:\n]*\.py):(\d+):/gm;
/** `at Ns.FooTests.Bar() in C:\src\FooTests.cs:line 42`. */
const DOTNET_FRAME = /\bin\s+(.+?):line\s+(\d+)/g;

function extensionsFor(language: string): string[] {
  return SOURCE_EXTENSIONS[language] ?? ['.java', '.py', '.cs', '.kt', '.ts', '.js'];
}

function looksLikeSource(file: string, language: string): boolean {
  return extensionsFor(language).some((ext) => file.toLowerCase().endsWith(ext));
}

function hasDirectorySegment(file: string): boolean {
  return file.includes('/') || file.includes('\\');
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function jvmClassName(qualified: string): string | undefined {
  const afterModule = qualified.slice(qualified.lastIndexOf('/') + 1);
  const lastDot = afterModule.lastIndexOf('.');
  return lastDot > 0 ? afterModule.slice(0, lastDot) : undefined;
}

interface IndexedFrame {
  index: number;
  frame: StackFrame;
}

function collect(
  pattern: RegExp,
  text: string,
  build: (match: RegExpExecArray) => StackFrame | undefined,
  into: IndexedFrame[],
): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const frame = build(match);
    if (frame) {
      into.push({ index: match.index, frame });
    }
  }
}

export function parseStackFrames(stackTrace: string, language: string): StackFrame[] {
  const found: IndexedFrame[] = [];
  const tryAll = !(language in SOURCE_EXTENSIONS);

  if (tryAll || language === 'java') {
    collect(
      JVM_FRAME,
      stackTrace,
      (match) => {
        const file = match[2];
        if (!looksLikeSource(file, 'java')) return undefined;
        return { className: jvmClassName(match[1]), file, line: Number(match[3]) };
      },
      found,
    );
  }
  if (tryAll || language === 'python') {
    const toFrame = (match: RegExpExecArray): StackFrame => ({
      file: match[1],
      line: Number(match[2]),
    });
    collect(PYTHON_TRACEBACK_FRAME, stackTrace, toFrame, found);
    collect(PYTEST_REPORT_FRAME, stackTrace, toFrame, found);
  }
  if (tryAll || language === 'csharp') {
    collect(
      DOTNET_FRAME,
      stackTrace,
      (match) => ({ file: match[1].trim(), line: Number(match[2]) }),
      found,
    );
  }

  return found
    .sort((a, b) => a.index - b.index)
    .map(({ frame }) => frame)
    .filter((frame) => Number.isFinite(frame.line) && frame.line > 0);
}

function classMatchesSuite(className: string | undefined, suite: string | undefined): boolean {
  if (!className || !suite) return false;
  if (className === suite) return true;
  return className.startsWith(`${suite}$`) || suite.startsWith(`${className}$`);
}

async function defaultListDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !IGNORED_DIRS.has(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export interface TestLocationResolverDeps {
  exists?: ExistsFn;
  listDirs?: ListDirsFn;
}

/** Instantiate per test run — filesystem probes are memoised for its lifetime. */
export class TestLocationResolver {
  private readonly exists: ExistsFn;
  private readonly listDirs: ListDirsFn;
  private readonly existsCache = new Map<string, Promise<boolean>>();
  private readonly suiteFiles = new Map<string, Promise<string | undefined>>();
  private readonly frameFiles = new Map<string, Promise<string | undefined>>();
  private modules?: Promise<string[]>;

  constructor(
    private readonly folderPath: string,
    private readonly language: string,
    deps: TestLocationResolverDeps = {},
  ) {
    this.exists = deps.exists ?? pathExists;
    this.listDirs = deps.listDirs ?? defaultListDirs;
  }

  async resolveSuiteFile(testSuite: string | undefined): Promise<string | undefined> {
    if (!testSuite) return undefined;
    let cached = this.suiteFiles.get(testSuite);
    if (!cached) {
      cached = this.probe(this.suiteCandidates(testSuite));
      this.suiteFiles.set(testSuite, cached);
    }
    return cached;
  }

  /** Prefers a frame belonging to the suite itself, then the first resolvable frame. */
  async resolveTestLocation(
    testSuite: string | undefined,
    stackTrace: string | undefined,
  ): Promise<SourceLocation | undefined> {
    const suiteFile = await this.resolveSuiteFile(testSuite);
    const frames = stackTrace ? parseStackFrames(stackTrace, this.language) : [];

    let fallback: SourceLocation | undefined;
    for (const frame of frames) {
      const file = await this.resolveFrameFile(frame);
      if (!file) continue;
      if (classMatchesSuite(frame.className, testSuite) || (suiteFile && samePath(file, suiteFile))) {
        return { file, line: frame.line };
      }
      fallback ??= { file, line: frame.line };
    }

    return fallback ?? (suiteFile ? { file: suiteFile } : undefined);
  }

  private async resolveFrameFile(frame: StackFrame): Promise<string | undefined> {
    const key = `${frame.className ?? ''}|${frame.file}`;
    let cached = this.frameFiles.get(key);
    if (!cached) {
      cached = this.locateFrameFile(frame);
      this.frameFiles.set(key, cached);
    }
    return cached;
  }

  private async locateFrameFile(frame: StackFrame): Promise<string | undefined> {
    if (isAbsolute(frame.file)) {
      const absolute = resolve(frame.file);
      return (await this.existsCached(absolute)) ? absolute : undefined;
    }
    if (hasDirectorySegment(frame.file)) {
      const direct = resolve(this.folderPath, frame.file);
      if (await this.existsCached(direct)) return direct;
      return this.probe([frame.file]);
    }

    const candidates: string[] = [];
    if (frame.className) {
      const extension = frame.file.slice(frame.file.lastIndexOf('.'));
      candidates.push(`${this.packagePath(frame.className)}${extension}`);
    }
    candidates.push(frame.file);
    return this.probe(candidates);
  }

  /** `com.pkg.FooTest$Inner` -> `com/pkg/FooTest`. */
  private packagePath(className: string): string {
    return className.split('$')[0].split('.').join('/');
  }

  private suiteCandidates(testSuite: string): string[] {
    const extensions = extensionsFor(this.language);
    const candidates = extensions.map((ext) => `${this.packagePath(testSuite)}${ext}`);

    const segments = testSuite.split('$')[0].split('.');
    if (segments.length > 1 && /^[A-Z]/.test(segments[segments.length - 1])) {
      // pytest: `tests.test_math.TestMath` -> file is the module, not the class.
      const withoutClass = segments.slice(0, -1).join('/');
      candidates.push(...extensions.map((ext) => `${withoutClass}${ext}`));
      candidates.push(...extensions.map((ext) => `${segments[segments.length - 1]}${ext}`));
    }
    return candidates;
  }

  private async probe(relatives: string[]): Promise<string | undefined> {
    const hit = await this.probeIn([''], relatives);
    return hit ?? this.probeIn(await this.moduleDirs(), relatives);
  }

  private async probeIn(modules: string[], relatives: string[]): Promise<string | undefined> {
    const roots = SOURCE_ROOTS[this.language] ?? DEFAULT_ROOTS;
    for (const module of modules) {
      for (const root of roots) {
        for (const relative of relatives) {
          const candidate = resolve(this.folderPath, module, root, relative);
          if (await this.existsCached(candidate)) {
            return candidate;
          }
        }
      }
    }
    return undefined;
  }

  private async moduleDirs(): Promise<string[]> {
    this.modules ??= this.listDirs(this.folderPath);
    return this.modules;
  }

  private existsCached(path: string): Promise<boolean> {
    let cached = this.existsCache.get(path);
    if (!cached) {
      cached = this.exists(path);
      this.existsCache.set(path, cached);
    }
    return cached;
  }
}
