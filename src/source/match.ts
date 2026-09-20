import type { TestDeclaration } from './language';
import { matchBackward } from './text';

function trimTrailingGroup(value: string, open: string, close: string): string | undefined {
  if (value[value.length - 1] !== close) return undefined;
  const start = matchBackward(value, value.length - 1, open, close);
  return start < 0 ? undefined : value.slice(0, start).trimEnd();
}

/** `test_add[2-3]`, `divideReturnsQuotient(int, int)[1]`, `Ns.Cls.Add_ReturnsSum`, `` `adds 2` ``. */
export function normalizeTestName(testName: string): string {
  let value = testName.trim();

  // Brackets and parens can nest and interleave, so strip whichever is currently trailing.
  for (;;) {
    const withoutBrackets = trimTrailingGroup(value, '[', ']');
    if (withoutBrackets !== undefined) {
      value = withoutBrackets;
      continue;
    }
    const withoutParens = trimTrailingGroup(value, '(', ')');
    if (withoutParens === undefined) break;
    value = withoutParens;
  }

  // Only after the argument list is gone, since dotnet theory arguments contain dots.
  // A space means this is a display name, not a qualified name, so leave it whole.
  const dot = value.lastIndexOf('.');
  if (dot >= 0 && !/\s/.test(value)) {
    value = value.slice(dot + 1);
  }

  return value.replace(/^`/, '').replace(/`$/, '');
}

function simpleName(qualified: string | undefined): string | undefined {
  if (!qualified) return undefined;
  const segments = qualified.split('.');
  const last = segments[segments.length - 1].split('$');
  return last[last.length - 1] || undefined;
}

const DISPLAY_NAME = /DisplayName\s*[=(]\s*"((?:[^"\\]|\\.)*)"/;

function displayNameOf(marker: string): string | undefined {
  const match = DISPLAY_NAME.exec(marker);
  return match ? match[1] : undefined;
}

function unique(
  candidates: TestDeclaration[],
  preferLine: number | undefined,
): TestDeclaration | undefined {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0 || preferLine === undefined) return undefined;
  const containing = candidates.filter(
    (declaration) => declaration.startLine <= preferLine && preferLine <= declaration.endLine,
  );
  return containing.length === 1 ? containing[0] : undefined;
}

/** An ambiguous name yields no match: the wrong snippet is worse than a whole-file fallback. */
export function matchDeclaration(
  declarations: TestDeclaration[],
  testName: string,
  testSuite: string | undefined,
  preferLine?: number,
): TestDeclaration | undefined {
  if (declarations.length === 0) return undefined;

  const normalized = normalizeTestName(testName);
  const suite = simpleName(testSuite);
  // A pytest module suite (`test_calculator`) names a file, not a class.
  const suiteIsType = suite !== undefined && /^[A-Z]/.test(suite);
  const inContainer =
    suite === undefined
      ? []
      : declarations.filter((declaration) =>
          suiteIsType
            ? simpleName(declaration.container) === suite
            : declaration.container === undefined,
        );

  const raw = testName.trim();
  const rules: Array<() => TestDeclaration[]> = [
    () => inContainer.filter((declaration) => declaration.name === normalized),
    () => declarations.filter((declaration) => declaration.name === normalized),
    () =>
      declarations.filter(
        (declaration) => declaration.name.toLowerCase() === normalized.toLowerCase(),
      ),
    () =>
      declarations.filter((declaration) =>
        declaration.markers.some((marker) => displayNameOf(marker) === raw),
      ),
  ];

  for (const rule of rules) {
    const hit = unique(rule(), preferLine);
    if (hit) return hit;
  }
  return undefined;
}
