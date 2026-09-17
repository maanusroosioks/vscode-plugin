// Scans for test *declarations* rather than using the line TestLocationResolver reports: that
// line comes from a stack trace, so only failing tests have one.

import type { SourceLanguage, TestDeclaration } from './source/language';
import { scanCLike } from './source/scanCLike';
import { scanPython } from './source/scanPython';

export type { SourceLanguage, TestDeclaration };
export { languageForFile } from './source/language';
export { maskCommentsAndStrings } from './source/mask';
export { normalizeCode } from './source/normalize';
export { sliceLines } from './source/text';
export { matchDeclaration, normalizeTestName } from './source/match';

export function scanTestDeclarations(text: string, language: SourceLanguage): TestDeclaration[] {
  return language === 'python' ? scanPython(text) : scanCLike(text, language);
}
