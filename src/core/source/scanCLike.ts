import type { SourceLanguage, TestDeclaration } from './language';
import { maskCommentsAndStrings } from './mask';
import { lineOf, lineStarts, matchBackward, matchForward, scanTopLevel } from './text';

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
    // `;` first means a forward declaration or an abstract member, not a body to descend into.
    const brace = scanTopLevel(masked, match.index + match[0].length, '{;');
    if (brace < 0 || masked[brace] !== '{') continue;

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

/** Where a member's body begins after its parameter list: a brace, an `=`/`=>` expression, or neither. */
function findBodyStart(masked: string, from: number): { braceOpen: number; expressionStart: number } {
  // Skips `throws A, B` (Java), `: Type` (Kotlin) and `where T : new()` (C#) to reach the body.
  let k = from;
  while (k < masked.length) {
    const stop = scanTopLevel(masked, k, '{;=');
    if (stop < 0 || masked[stop] === ';') break;
    if (masked[stop] === '{') return { braceOpen: stop, expressionStart: -1 };
    // `==` is a comparison in a constraint or default argument, not the start of a body.
    if (masked[stop + 1] === '=') {
      k = stop + 2;
      continue;
    }
    return { braceOpen: -1, expressionStart: stop + (masked[stop + 1] === '>' ? 2 : 1) };
  }
  return { braceOpen: -1, expressionStart: -1 };
}

function parseMember(
  text: string,
  masked: string,
  start: number,
  language: SourceLanguage,
): ParsedMember | undefined {
  const { markers, end: afterMarkers } = collectMarkers(text, masked, start, language);

  // A brace, terminator or assignment before the parameter list means this isn't a method.
  const parenOpen = scanTopLevel(masked, afterMarkers, '({};=', { unbalancedClose: true });
  if (parenOpen < 0 || masked[parenOpen] !== '(') return undefined;

  const named = readNameBackward(text, masked, parenOpen);
  if (!named) return undefined;

  const parenClose = matchForward(masked, parenOpen, '(', ')');
  if (parenClose < 0) return undefined;

  const { braceOpen, expressionStart } = findBodyStart(masked, parenClose + 1);

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
    // A closer with no opener of its own ends the expression: it belongs to the enclosing type.
    const stop = scanTopLevel(masked, expressionStart, language === 'kotlin' ? ';\n' : ';', {
      unbalancedClose: true,
    });
    const end = stop < 0 ? masked.length : stop;
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

export function scanCLike(text: string, language: SourceLanguage): TestDeclaration[] {
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
