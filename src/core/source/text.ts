export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** 1-based. */
export function lineOf(starts: number[], offset: number): number {
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

export function matchForward(masked: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    if (masked[i] === open) depth++;
    else if (masked[i] === close && --depth === 0) return i;
  }
  return -1;
}

export function matchBackward(masked: string, closeIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = closeIndex; i >= 0; i--) {
    if (masked[i] === close) depth++;
    else if (masked[i] === open && --depth === 0) return i;
  }
  return -1;
}

const OPENERS = '([{';
const CLOSERS = ')]}';

export interface ScanOptions {
  /** Treat a closer that has no opener in range as a stop, rather than walking past it. */
  unbalancedClose?: boolean;
}

/**
 * First index at or after `from` holding one of `stops` outside any bracket, or -1. Stops are
 * tested before depth is updated, so a bracket can itself be a stop char.
 */
export function scanTopLevel(
  masked: string,
  from: number,
  stops: string,
  { unbalancedClose = false }: ScanOptions = {},
): number {
  let depth = 0;
  for (let i = from; i < masked.length; i++) {
    const char = masked[i];
    if (depth === 0 && stops.includes(char)) return i;
    if (OPENERS.includes(char)) {
      depth++;
    } else if (CLOSERS.includes(char)) {
      if (depth === 0) {
        if (unbalancedClose) return i;
      } else {
        depth--;
      }
    }
  }
  return -1;
}
