// Scans for test *declarations* rather than using the line TestLocationResolver reports: that
// line comes from a stack trace, so only failing tests have one.

export type SourceLanguage = 'python' | 'java' | 'kotlin' | 'csharp';

export interface TestDeclaration {
  name: string;
  /** Dotted outermost-first. Absent for a module-level function. */
  container?: string;
  /** 1-based, the first decorator/annotation/attribute line. */
  startLine: number;
  /** 1-based inclusive. */
  endLine: number;
  markers: string[];
  containerMarkers: string[];
  /** Excludes the signature and markers. */
  bodyText: string;
}

const EXTENSION_LANGUAGES: Record<string, SourceLanguage> = {
  '.py': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.cs': 'csharp',
};

const RUN_LANGUAGES: Record<string, SourceLanguage> = {
  java: 'java',
  python: 'python',
  csharp: 'csharp',
};

/** `SOURCE_EXTENSIONS.java` also covers `.kt`, so a Kotlin file can arrive under language `java`. */
export function languageForFile(filePath: string, runLanguage: string): SourceLanguage | undefined {
  const dot = filePath.lastIndexOf('.');
  const extension = dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
  return EXTENSION_LANGUAGES[extension] ?? RUN_LANGUAGES[runLanguage];
}

// ------------------------------------------------------------------- masking ----

interface Literal {
  contentStart: number;
  contentEnd: number;
  end: number;
}

function endOfLine(text: string, from: number): number {
  const newline = text.indexOf('\n', from);
  return newline < 0 ? text.length : newline;
}

function quotedLiteral(text: string, quoteIndex: number, language: SourceLanguage): Literal {
  const quote = text[quoteIndex];
  const triple = text.startsWith(quote.repeat(3), quoteIndex);
  const delimiter = triple ? quote.repeat(3) : quote;
  // Kotlin raw strings and C# raw string literals are the two that take backslashes literally.
  const escapes = !triple || language === 'python' || language === 'java';
  const contentStart = quoteIndex + delimiter.length;

  let i = contentStart;
  while (i < text.length) {
    if (escapes && text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text.startsWith(delimiter, i)) {
      return { contentStart, contentEnd: i, end: i + delimiter.length };
    }
    // An unterminated single-line string must not swallow the rest of the file.
    if (!triple && text[i] === '\n') {
      return { contentStart, contentEnd: i, end: i };
    }
    i++;
  }
  return { contentStart, contentEnd: text.length, end: text.length };
}

function verbatimLiteral(text: string, quoteIndex: number): Literal {
  const contentStart = quoteIndex + 1;
  let i = contentStart;
  while (i < text.length) {
    if (text[i] === '"') {
      if (text[i + 1] === '"') {
        i += 2;
        continue;
      }
      return { contentStart, contentEnd: i, end: i + 1 };
    }
    i++;
  }
  return { contentStart, contentEnd: text.length, end: text.length };
}

function literalAt(text: string, index: number, language: SourceLanguage): Literal | undefined {
  const char = text[index];

  if (language === 'csharp' && (char === '@' || char === '$')) {
    let i = index;
    let verbatim = false;
    while (text[i] === '@' || text[i] === '$') {
      if (text[i] === '@') verbatim = true;
      i++;
    }
    if (text[i] !== '"') return undefined;
    return verbatim ? verbatimLiteral(text, i) : quotedLiteral(text, i, language);
  }

  if (char === '"' || char === "'") {
    return quotedLiteral(text, index, language);
  }
  return undefined;
}

function mask(
  text: string,
  language: SourceLanguage,
  maskStrings: boolean,
  literals?: Array<[number, number]>,
): string {
  const out = text.split('');
  const blank = (from: number, to: number): void => {
    for (let i = Math.max(0, from); i < Math.min(to, text.length); i++) {
      if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
    }
  };

  const cLike = language !== 'python';
  let i = 0;
  while (i < text.length) {
    const char = text[i];

    if (language === 'python' && char === '#') {
      const end = endOfLine(text, i);
      blank(i, end);
      i = end;
      continue;
    }
    if (cLike && char === '/' && text[i + 1] === '/') {
      const end = endOfLine(text, i);
      blank(i, end);
      i = end;
      continue;
    }
    if (cLike && char === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? text.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }

    // Skipped over even when they're being kept, so a `//` inside a string isn't read as a comment.
    const literal = literalAt(text, i, language);
    if (literal) {
      literals?.push([literal.contentStart, literal.contentEnd]);
      if (maskStrings) blank(literal.contentStart, literal.contentEnd);
      i = Math.max(literal.end, i + 1);
      continue;
    }
    i++;
  }

  return out.join('');
}

export function maskCommentsAndStrings(text: string, language: SourceLanguage): string {
  return mask(text, language, true);
}

/** One pass for both halves normalisation needs: comments blanked, literal content flagged. */
function stripComments(text: string, language: SourceLanguage): { text: string; inLiteral: boolean[] } {
  const ranges: Array<[number, number]> = [];
  const stripped = mask(text, language, false, ranges);

  const inLiteral = new Array<boolean>(text.length).fill(false);
  for (const [start, end] of ranges) {
    for (let i = Math.max(0, start); i < Math.min(end, text.length); i++) {
      inLiteral[i] = true;
    }
  }
  return { text: stripped, inLiteral };
}

/** Languages where indentation is syntax rather than layout. */
const INDENT_SIGNIFICANT = new Set<SourceLanguage>(['python']);

function collapseNaively(code: string): string {
  return code
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .filter((line) => line !== '')
    .join('\n');
}

export function normalizeCode(code: string, language: SourceLanguage | undefined): string {
  if (!language) return collapseNaively(code);

  const { text, inLiteral: literal } = stripComments(code, language);
  const lines: Array<{ indent: number; content: string; continuation: boolean }> = [];

  let offset = 0;
  for (const raw of text.split('\n')) {
    if (literal[offset]) {
      // Opens inside a multi-line literal, so the whole line is value: keep it byte for byte.
      if (raw !== '') lines.push({ indent: 0, content: raw, continuation: true });
    } else {
      const indent = raw.length - raw.replace(/^[ \t]+/, '').length;
      let content = '';
      let gap = false;
      for (let i = indent; i < raw.length; i++) {
        const char = raw[i];
        if (!literal[offset + i] && (char === ' ' || char === '\t')) {
          gap = true;
          continue;
        }
        if (gap) {
          content += ' ';
          gap = false;
        }
        content += char;
      }
      if (content !== '') lines.push({ indent, content, continuation: false });
    }
    offset += raw.length + 1;
  }

  if (!INDENT_SIGNIFICANT.has(language)) {
    return lines.map((line) => line.content).join('\n');
  }

  // Ordinal depth rather than raw width, so tabs-vs-spaces and 2-vs-4 reindents are equivalent.
  const widths = [...new Set(lines.filter((line) => !line.continuation).map((line) => line.indent))].sort(
    (a, b) => a - b,
  );
  return lines
    .map((line) =>
      line.continuation ? line.content : `${widths.indexOf(line.indent)} ${line.content}`,
    )
    .join('\n');
}

// --------------------------------------------------------------------- lines ----

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** 1-based. */
function lineOf(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** Both bounds 1-based and inclusive. */
export function sliceLines(text: string, startLine: number, endLine: number): string {
  const starts = lineStarts(text);
  const from = starts[Math.max(1, startLine) - 1] ?? 0;
  const to = starts[endLine] ?? text.length;
  return text.slice(from, to).replace(/\r?\n$/, '');
}

// ---------------------------------------------------------------- delimiters ----

function matchForward(masked: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    if (masked[i] === open) depth++;
    else if (masked[i] === close && --depth === 0) return i;
  }
  return -1;
}

function matchBackward(masked: string, closeIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = closeIndex; i >= 0; i--) {
    if (masked[i] === close) depth++;
    else if (masked[i] === open && --depth === 0) return i;
  }
  return -1;
}

// -------------------------------------------------------------------- python ----

const PY_DECORATOR = /^[ \t]*@/;
const PY_CLASS = /^[ \t]*class[ \t]+([A-Za-z_]\w*)/;
// pytest's default `python_functions = test*`.
const PY_TEST = /^[ \t]*(?:async[ \t]+)?def[ \t]+(test\w*)[ \t]*\(/;

interface PythonClass {
  name: string;
  indent: number;
  markers: string[];
}

interface PendingMarkers {
  indent: number;
  startLine: number;
  markers: string[];
}

/** Last line of a construct whose brackets opened on `from`, so multi-line decorators stay whole. */
function consumeBalanced(maskedLines: string[], from: number): number {
  let depth = 0;
  for (let i = from; i < maskedLines.length; i++) {
    for (const char of maskedLines[i]) {
      if (char === '(' || char === '[' || char === '{') depth++;
      else if (char === ')' || char === ']' || char === '}') depth--;
    }
    if (depth <= 0) return i;
  }
  return maskedLines.length - 1;
}

/** Index of the `:` closing a `def` signature, or -1 — bracket-aware, so `lambda:` is skipped. */
function signatureColon(maskedLine: string): number {
  let depth = 0;
  for (let i = 0; i < maskedLine.length; i++) {
    const char = maskedLine[i];
    if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') depth--;
    else if (char === ':' && depth === 0) return i;
  }
  return -1;
}

function scanPython(text: string): TestDeclaration[] {
  const masked = maskCommentsAndStrings(text, 'python');
  const lines = text.split('\n');
  const maskedLines = masked.split('\n');
  const declarations: TestDeclaration[] = [];
  const classStack: PythonClass[] = [];
  let pending: PendingMarkers | undefined;

  const indentOf = (line: string): number => line.length - line.trimStart().length;
  const isBlank = (index: number): boolean => maskedLines[index].trim() === '';

  for (let i = 0; i < lines.length; i++) {
    if (isBlank(i)) continue;
    const maskedLine = maskedLines[i];
    const indent = indentOf(maskedLine);

    while (classStack.length > 0 && classStack[classStack.length - 1].indent >= indent) {
      classStack.pop();
    }

    if (PY_DECORATOR.test(maskedLine)) {
      const end = consumeBalanced(maskedLines, i);
      const marker = lines.slice(i, end + 1).join('\n').trim();
      if (pending && pending.indent === indent) {
        pending.markers.push(marker);
      } else {
        pending = { indent, startLine: i + 1, markers: [marker] };
      }
      i = end;
      continue;
    }

    const classMatch = PY_CLASS.exec(maskedLine);
    if (classMatch) {
      classStack.push({
        name: classMatch[1],
        indent,
        markers: pending && pending.indent === indent ? pending.markers : [],
      });
      pending = undefined;
      continue;
    }

    const testMatch = PY_TEST.exec(maskedLine);
    if (!testMatch) {
      pending = undefined;
      continue;
    }

    const signatureLine = i + 1;
    const attached = pending && pending.indent === indent ? pending : undefined;
    pending = undefined;

    const signatureEnd = consumeBalanced(maskedLines, i);
    const colon = signatureColon(maskedLines[signatureEnd]);
    const inline = colon >= 0 ? maskedLines[signatureEnd].slice(colon + 1) : '';

    let endLine: number;
    let bodyText: string;
    if (inline.trim() !== '') {
      endLine = signatureEnd + 1;
      bodyText = lines[signatureEnd].slice(colon + 1).trim();
      i = signatureEnd;
    } else {
      let last = signatureEnd;
      for (let j = signatureEnd + 1; j < lines.length; j++) {
        if (isBlank(j)) continue;
        if (indentOf(maskedLines[j]) <= indent) break;
        last = j;
      }
      endLine = last + 1;
      bodyText = last > signatureEnd ? sliceLines(text, signatureEnd + 2, endLine) : '';
      i = last;
    }

    declarations.push({
      name: testMatch[1],
      container: classStack.length > 0 ? classStack.map((entry) => entry.name).join('.') : undefined,
      startLine: attached?.startLine ?? signatureLine,
      endLine,
      markers: attached?.markers ?? [],
      containerMarkers: classStack[classStack.length - 1]?.markers ?? [],
      bodyText,
    });
  }

  return declarations;
}

// ---------------------------------------------------------------- java/kt/c# ----

const JVM_TEST_ANNOTATION =
  /@[ \t]*(?:[A-Za-z_]\w*[ \t]*\.[ \t]*)*(ParameterizedTest|RepeatedTest|TestFactory|TestTemplate|Test)\b/g;
// Anchored to the start of a line, on the mask, so array/indexer syntax can't pose as an attribute.
const CSHARP_TEST_ATTRIBUTE =
  /^[ \t]*\[[ \t]*(?:[A-Za-z_]\w*[ \t]*\.[ \t]*)*(DataTestMethod|TestMethod|TestCase|Theory|Fact|Test)\b/gm;
const TYPE_DECLARATION = /\b(?:class|interface|record|struct|enum|object)[ \t]+([A-Za-z_]\w*)/g;

interface TypeRange {
  name: string;
  start: number;
  end: number;
  markers: string[];
}

function isMarkerOpener(char: string, language: SourceLanguage): boolean {
  return language === 'csharp' ? char === '[' : char === '@';
}

/** Walks back over contiguous annotations/attributes. Masked Javadoc reads as blank, so it stops there. */
function expandMarkersBackward(masked: string, offset: number, language: SourceLanguage): number {
  let start = offset;
  for (;;) {
    let i = start - 1;
    while (i >= 0 && /\s/.test(masked[i])) i--;
    if (i < 0) return start;

    if (masked[i] === ']') {
      if (language !== 'csharp') return start;
      const open = matchBackward(masked, i, '[', ']');
      if (open < 0) return start;
      start = open;
      continue;
    }

    if (masked[i] === ')') {
      const open = matchBackward(masked, i, '(', ')');
      if (open < 0) return start;
      i = open - 1;
      while (i >= 0 && /\s/.test(masked[i])) i--;
    }

    let name = i;
    while (name >= 0 && /[A-Za-z0-9_.]/.test(masked[name])) name--;
    if (name === i || name < 0 || masked[name] !== '@' || language === 'csharp') return start;
    start = name;
  }
}

function collectMarkers(
  text: string,
  masked: string,
  start: number,
  language: SourceLanguage,
): { markers: string[]; end: number } {
  const markers: string[] = [];
  let i = start;

  for (;;) {
    while (i < masked.length && /\s/.test(masked[i])) i++;
    if (!isMarkerOpener(masked[i], language)) break;

    if (language === 'csharp') {
      const close = matchForward(masked, i, '[', ']');
      if (close < 0) break;
      markers.push(text.slice(i, close + 1).trim());
      i = close + 1;
      continue;
    }

    let j = i + 1;
    while (j < masked.length && /[A-Za-z0-9_.]/.test(masked[j])) j++;
    // Only spaces/tabs, never a newline: otherwise `@Test\nvoid foo()` eats the parameter list.
    let k = j;
    while (k < masked.length && /[ \t]/.test(masked[k])) k++;
    if (masked[k] === '(') {
      const close = matchForward(masked, k, '(', ')');
      if (close < 0) break;
      j = close + 1;
    }
    markers.push(text.slice(i, j).trim());
    i = j;
  }

  return { markers, end: i };
}

function readNameBackward(
  text: string,
  masked: string,
  parenOpen: number,
): { name: string; start: number } | undefined {
  let i = parenOpen - 1;
  while (i >= 0 && /\s/.test(masked[i])) i--;
  if (i < 0) return undefined;

  if (text[i] === '`') {
    const open = text.lastIndexOf('`', i - 1);
    return open < 0 ? undefined : { name: text.slice(open + 1, i), start: open };
  }

  let j = i;
  while (j >= 0 && /[A-Za-z0-9_$]/.test(masked[j])) j--;
  return j === i ? undefined : { name: text.slice(j + 1, i + 1), start: j + 1 };
}

function scanTypeRanges(text: string, masked: string, language: SourceLanguage): TypeRange[] {
  const ranges: TypeRange[] = [];
  TYPE_DECLARATION.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TYPE_DECLARATION.exec(masked)) !== null) {
    let i = match.index + match[0].length;
    let parens = 0;
    let brace = -1;
    while (i < masked.length) {
      const char = masked[i];
      if (char === '(') parens++;
      else if (char === ')') parens--;
      else if (parens === 0 && char === ';') break;
      else if (parens === 0 && char === '{') {
        brace = i;
        break;
      }
      i++;
    }
    if (brace < 0) continue;

    const end = matchForward(masked, brace, '{', '}');
    if (end < 0) continue;

    const markerStart = expandMarkersBackward(masked, match.index, language);
    ranges.push({
      name: match[1],
      start: match.index,
      end,
      markers: markerStart < match.index ? collectMarkers(text, masked, markerStart, language).markers : [],
    });
  }

  return ranges;
}

function containersOf(ranges: TypeRange[], offset: number): TypeRange[] {
  return ranges.filter((range) => range.start < offset && offset < range.end);
}

function testMarkerOffsets(masked: string, language: SourceLanguage): number[] {
  // The C# pattern is line-anchored, so its match starts at the indent rather than at the `[`.
  const csharp = language === 'csharp';
  const pattern = csharp ? CSHARP_TEST_ATTRIBUTE : JVM_TEST_ANNOTATION;
  pattern.lastIndex = 0;

  const offsets: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) {
    offsets.push(csharp ? match.index + match[0].indexOf('[') : match.index);
  }
  return offsets;
}

interface ParsedMember {
  name: string;
  signatureOffset: number;
  endOffset: number;
  markers: string[];
  bodyText: string;
}

function parseMember(
  text: string,
  masked: string,
  start: number,
  language: SourceLanguage,
): ParsedMember | undefined {
  const { markers, end: afterMarkers } = collectMarkers(text, masked, start, language);

  let i = afterMarkers;
  let parenOpen = -1;
  while (i < masked.length) {
    const char = masked[i];
    if (char === '(') {
      parenOpen = i;
      break;
    }
    // A brace, terminator or assignment before the parameter list means this isn't a method.
    if (char === '{' || char === '}' || char === ';' || char === '=') break;
    i++;
  }
  if (parenOpen < 0) return undefined;

  const named = readNameBackward(text, masked, parenOpen);
  if (!named) return undefined;

  const parenClose = matchForward(masked, parenOpen, '(', ')');
  if (parenClose < 0) return undefined;

  // Skip `throws A, B` (Java), `: Type` (Kotlin) and `where T : new()` (C#) to reach the body.
  let k = parenClose + 1;
  let depth = 0;
  let braceOpen = -1;
  let expressionStart = -1;
  while (k < masked.length) {
    const char = masked[k];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0) {
      if (char === '{') {
        braceOpen = k;
        break;
      }
      if (char === ';') break;
      if (char === '=' && masked[k + 1] !== '=') {
        expressionStart = k + (masked[k + 1] === '>' ? 2 : 1);
        break;
      }
    }
    k++;
  }

  if (braceOpen >= 0) {
    const braceClose = matchForward(masked, braceOpen, '{', '}');
    if (braceClose < 0) return undefined;
    return {
      name: named.name,
      signatureOffset: named.start,
      endOffset: braceClose,
      markers,
      bodyText: text.slice(braceOpen + 1, braceClose),
    };
  }

  if (expressionStart >= 0) {
    let j = expressionStart;
    let expressionDepth = 0;
    let end = masked.length;
    while (j < masked.length) {
      const char = masked[j];
      if (char === '(' || char === '[' || char === '{') expressionDepth++;
      else if (char === ')' || char === ']' || char === '}') {
        if (expressionDepth === 0) {
          end = j;
          break;
        }
        expressionDepth--;
      } else if (expressionDepth === 0 && (char === ';' || (char === '\n' && language === 'kotlin'))) {
        end = j;
        break;
      }
      j++;
    }
    return {
      name: named.name,
      signatureOffset: named.start,
      endOffset: end,
      markers,
      bodyText: text.slice(expressionStart, end).trim(),
    };
  }

  return undefined;
}

function scanCLike(text: string, language: SourceLanguage): TestDeclaration[] {
  const masked = maskCommentsAndStrings(text, language);
  const starts = lineStarts(text);
  const types = scanTypeRanges(text, masked, language);
  const declarations: TestDeclaration[] = [];
  const seen = new Set<number>();

  for (const offset of testMarkerOffsets(masked, language)) {
    const start = expandMarkersBackward(masked, offset, language);
    const member = parseMember(text, masked, start, language);
    if (!member || seen.has(member.signatureOffset)) continue;
    seen.add(member.signatureOffset);

    const enclosing = containersOf(types, member.signatureOffset);
    declarations.push({
      name: member.name,
      container: enclosing.length > 0 ? enclosing.map((range) => range.name).join('.') : undefined,
      startLine: lineOf(starts, start),
      endLine: lineOf(starts, member.endOffset),
      markers: member.markers,
      containerMarkers: enclosing[enclosing.length - 1]?.markers ?? [],
      bodyText: member.bodyText,
    });
  }

  return declarations.sort((a, b) => a.startLine - b.startLine);
}

export function scanTestDeclarations(text: string, language: SourceLanguage): TestDeclaration[] {
  return language === 'python' ? scanPython(text) : scanCLike(text, language);
}

// ------------------------------------------------------------------ matching ----

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
