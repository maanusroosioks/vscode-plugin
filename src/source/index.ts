// Scans for test *declarations* rather than using the line TestLocationResolver reports: that
// line comes from a stack trace, so only failing tests have one.

import type { SourceLanguage, TestDeclaration } from './language';
import { scanCLike } from './scanCLike';
import { scanPython } from './scanPython';

export type { SourceLanguage, TestDeclaration };
export { languageForFile } from './language';
export { maskCommentsAndStrings } from './mask';
export { normalizeCode } from './normalize';
export { sliceLines } from './text';
export { matchDeclaration, normalizeTestName } from './match';

export function scanTestDeclarations(text: string, language: SourceLanguage): TestDeclaration[] {
  return language === 'python' ? scanPython(text) : scanCLike(text, language);
}
