import type { SourceLanguage } from './language';
import { stripComments } from './mask';

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

  // Everywhere but Python, indentation is layout rather than syntax.
  if (language !== 'python') {
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
