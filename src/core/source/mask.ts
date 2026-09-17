import type { SourceLanguage } from './language';

// ----------------------------------------------------------------- literals ----

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
export function stripComments(text: string, language: SourceLanguage): { text: string; inLiteral: boolean[] } {
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
