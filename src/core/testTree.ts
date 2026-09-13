const SEPARATOR = '::';

export const NO_SUITE = '(no suite)';

/** Remembered across window reloads so the tree isn't empty on startup. */
export interface KnownTest {
  suite: string;
  name: string;
  file?: string;
}

export function folderItemId(folderPath: string): string {
  return folderPath;
}

export function suiteItemId(folderPath: string, suite: string): string {
  return `${folderPath}${SEPARATOR}${suite}`;
}

export function testItemId(folderPath: string, suite: string, testName: string): string {
  return `${folderPath}${SEPARATOR}${suite}${SEPARATOR}${testName}`;
}

export function suiteKey(suite: string | undefined): string {
  const trimmed = suite?.trim();
  return trimmed ? trimmed : NO_SUITE;
}

/** `com.pkg.FooTest` -> `FooTest`; the full name goes in the item description. */
export function suiteLabel(suite: string): string {
  const lastDot = suite.lastIndexOf('.');
  const short = lastDot >= 0 ? suite.slice(lastDot + 1) : suite;
  return short.length > 0 ? short : suite;
}

/** `undefined` when the label already shows everything the full name would. */
export function suiteDescription(suite: string): string | undefined {
  return suiteLabel(suite) === suite ? undefined : suite;
}
