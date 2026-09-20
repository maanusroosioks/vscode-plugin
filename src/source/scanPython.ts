import type { TestDeclaration } from './language';
import { maskCommentsAndStrings } from './mask';
import { scanTopLevel, sliceLines } from './text';

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
  return scanTopLevel(maskedLine, 0, ':');
}

export function scanPython(text: string): TestDeclaration[] {
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
