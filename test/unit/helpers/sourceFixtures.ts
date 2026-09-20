import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  scanTestDeclarations,
  type SourceLanguage,
  type TestDeclaration,
} from '../../../src/source';

const FIXTURES_DIR = join(__dirname, '../fixtures/source');

export function fixture(relative: string): string {
  return readFileSync(join(FIXTURES_DIR, relative), 'utf8');
}

export function scan(relative: string, language: SourceLanguage): TestDeclaration[] {
  return scanTestDeclarations(fixture(relative), language);
}

/** Scanned once and shared: every suite below asserts against the same four fixtures. */
export const declarations = {
  python: scan('python/test_calculator.py', 'python'),
  java: scan('java/CalculatorTest.java', 'java'),
  kotlin: scan('kotlin/CalculatorTest.kt', 'kotlin'),
  csharp: scan('csharp/CalculatorTests.cs', 'csharp'),
};

export const sources = {
  python: fixture('python/test_calculator.py'),
  java: fixture('java/CalculatorTest.java'),
  kotlin: fixture('kotlin/CalculatorTest.kt'),
  csharp: fixture('csharp/CalculatorTests.cs'),
};

/** Fails the test rather than silently picking one when a fixture has same-named declarations. */
export function declarationNamed(found: TestDeclaration[], name: string): TestDeclaration {
  const hits = found.filter((declaration) => declaration.name === name);
  expect(hits, `expected exactly one declaration named ${name}`).toHaveLength(1);
  return hits[0];
}
