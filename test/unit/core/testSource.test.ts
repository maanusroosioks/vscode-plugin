import { describe, expect, it } from 'vitest';
import {
  languageForFile,
  maskCommentsAndStrings,
  sliceLines,
  type TestDeclaration,
} from '../../../src/core/testSource';
import { declarationNamed as find, fixture, scan } from '../helpers/sourceFixtures';

function names(declarations: TestDeclaration[]): string[] {
  return declarations.map((declaration) => declaration.name);
}

function snippet(text: string, declaration: TestDeclaration): string {
  return sliceLines(text, declaration.startLine, declaration.endLine);
}

describe('languageForFile', () => {
  it('prefers the file extension over the adapter language', () => {
    // The java adapter also covers .kt, so the extension has to win.
    expect(languageForFile('/p/src/test/kotlin/FooTest.kt', 'java')).toBe('kotlin');
    expect(languageForFile('/p/src/test/java/FooTest.java', 'java')).toBe('java');
  });

  it('falls back to the adapter language when the extension is unknown', () => {
    expect(languageForFile('/p/FooTest.groovy', 'java')).toBe('java');
    expect(languageForFile('/p/FooTest.groovy', 'elixir')).toBeUndefined();
  });
});

describe('maskCommentsAndStrings', () => {
  it('preserves length and newlines', () => {
    const text = 'a = "hello"  # trailing\nb = 2\n';
    const masked = maskCommentsAndStrings(text, 'python');
    expect(masked).toHaveLength(text.length);
    expect(masked.split('\n')).toHaveLength(text.split('\n').length);
  });

  it('blanks braces inside string literals but keeps the code around them', () => {
    const masked = maskCommentsAndStrings('if (x) { s = "}"; }', 'java');
    expect(masked).toBe('if (x) { s = " "; }');
  });

  it('handles C# verbatim strings, where "" escapes a quote', () => {
    const masked = maskCommentsAndStrings('var v = @"a } "" b"; var n = 1;', 'csharp');
    expect(masked).toBe('var v = @"        "; var n = 1;');
  });

  it('does not process escapes inside a Kotlin raw string', () => {
    const masked = maskCommentsAndStrings('val v = """a \\ } b""" + c', 'kotlin');
    expect(masked).toBe('val v = """       """ + c');
  });

  it('blanks block comments', () => {
    const masked = maskCommentsAndStrings('/* @Test */ void f() {}', 'java');
    expect(masked).not.toContain('@Test');
    expect(masked).toContain('void f() {}');
  });
});

describe('scanTestDeclarations — python', () => {
  const text = fixture('python/test_calculator.py');
  const declarations = scan('python/test_calculator.py', 'python');

  it('finds every test function and no helpers or commented-out decoys', () => {
    expect(names(declarations)).toEqual([
      'test_add_returns_sum',
      'test_divide_returns_quotient',
      'test_uses_a_nested_helper',
      'test_empty_body',
      'test_only_a_docstring',
      'test_skipped_outright',
      'test_async_add',
      'test_one_liner',
      'test_brace_in_a_string',
      'test_add',
      'test_divide_by_zero',
      'test_add',
    ]);
    expect(names(declarations)).not.toContain('helper');
    expect(names(declarations)).not.toContain('test_decoy');
  });

  it('includes a multi-line decorator in the snippet', () => {
    const code = snippet(text, find(declarations, 'test_divide_returns_quotient'));
    expect(code).toContain('@pytest.mark.parametrize');
    expect(code).toContain('(9, 3, 3),');
    expect(code).toContain('assert divide(a, b) == expected');
    expect(code).not.toContain('def test_uses_a_nested_helper');
  });

  it('ends the body by indentation, so a nested function stays inside', () => {
    const code = snippet(text, find(declarations, 'test_uses_a_nested_helper'));
    expect(code).toContain('def inner(value):');
    expect(code).toContain('assert inner(add(1, 1)) == 3');
    expect(code).not.toContain('def test_empty_body');
  });

  it('handles a one-line body', () => {
    const declaration = find(declarations, 'test_one_liner');
    expect(declaration.bodyText).toBe('assert add(0, 0) == 0');
    expect(declaration.startLine).toBe(declaration.endLine);
  });

  it('assigns class containers and their markers', () => {
    const inClass = declarations.filter((declaration) => declaration.name === 'test_add');
    expect(inClass.map((declaration) => declaration.container)).toEqual(['TestMath', 'TestParked']);
    expect(inClass[0].containerMarkers).toEqual([]);
    expect(inClass[1].containerMarkers).toEqual(['@pytest.mark.skip(reason="whole class parked")']);
  });

  it('records the test’s own markers', () => {
    expect(find(declarations, 'test_skipped_outright').markers).toEqual([
      '@pytest.mark.skip(reason="not implemented yet")',
    ]);
    expect(find(declarations, 'test_add_returns_sum').markers).toEqual([]);
  });

  it('treats a docstring-only body as the body', () => {
    expect(find(declarations, 'test_only_a_docstring').bodyText.trim()).toBe(
      '"""Should have asserted something."""',
    );
  });
});

describe('scanTestDeclarations — java', () => {
  const text = fixture('java/CalculatorTest.java');
  const declarations = scan('java/CalculatorTest.java', 'java');

  it('finds annotated tests and ignores helpers and Javadoc mentions', () => {
    expect(names(declarations)).toEqual([
      'addReturnsSum',
      'divideReturnsQuotient',
      'parkedTest',
      'displayNamed',
      'braceInsideAString',
      'emptyBody',
      'genericSignature',
      'throwsOnDivideByZero',
      'ambiguous',
      'ambiguous',
    ]);
    expect(names(declarations)).not.toContain('helper');
  });

  it('keeps @ParameterizedTest and @CsvSource together in the snippet', () => {
    const code = snippet(text, find(declarations, 'divideReturnsQuotient'));
    expect(code).toContain('@ParameterizedTest');
    expect(code).toContain('@CsvSource({');
    expect(code).toContain('"9, 3, 3"');
    expect(code).toContain('assertEquals(expected, calculator.divide(a, b));');
  });

  it('walks back over a stacked @Disabled', () => {
    const declaration = find(declarations, 'parkedTest');
    expect(declaration.markers).toEqual(['@Disabled("parked")', '@Test']);
    expect(snippet(text, declaration)).toContain('@Disabled("parked")');
  });

  it('does not absorb the preceding Javadoc block', () => {
    expect(snippet(text, find(declarations, 'addReturnsSum'))).not.toContain('Javadoc');
  });

  it('brace-matches past a brace inside a string literal', () => {
    expect(find(declarations, 'braceInsideAString').bodyText).toContain('calculator.format("{")');
  });

  it('handles a generic signature and a throws clause', () => {
    expect(find(declarations, 'genericSignature').bodyText).toContain('assertTrue');
    expect(find(declarations, 'throwsOnDivideByZero').bodyText).toContain('assertThrows');
  });

  it('records dotted containers for @Nested classes', () => {
    const ambiguous = declarations.filter((declaration) => declaration.name === 'ambiguous');
    expect(ambiguous.map((declaration) => declaration.container)).toEqual([
      'CalculatorTest.InnerCases',
      'CalculatorTest.OtherCases',
    ]);
    expect(ambiguous[0].containerMarkers).toEqual(['@Nested']);
  });

  it('reports an empty body as empty', () => {
    expect(find(declarations, 'emptyBody').bodyText.trim()).toBe('');
  });
});

describe('scanTestDeclarations — kotlin', () => {
  const declarations = scan('kotlin/CalculatorTest.kt', 'kotlin');

  it('finds backticked and expression-bodied tests', () => {
    expect(names(declarations)).toEqual([
      'adds two and three',
      'expressionBodied',
      'rawStringWithBrace',
      'emptyBody',
    ]);
  });

  it('captures an expression body', () => {
    expect(find(declarations, 'expressionBodied').bodyText).toBe(
      'assertTrue(calculator.add(1, 1) == 2)',
    );
  });

  it('brace-matches past a raw string containing braces', () => {
    const declaration = find(declarations, 'rawStringWithBrace');
    expect(declaration.bodyText).toContain('assertTrue(template.contains("not"))');
  });
});

describe('scanTestDeclarations — csharp', () => {
  const text = fixture('csharp/CalculatorTests.cs');
  const declarations = scan('csharp/CalculatorTests.cs', 'csharp');

  it('finds attributed tests and ignores array syntax and helpers', () => {
    expect(names(declarations)).toEqual([
      'Add_ReturnsSum',
      'Divide_ReturnsQuotient',
      'Divide_ByZero_Throws',
      'Parked',
      'DisplayNamed',
      'ExpressionBodied',
      'BraceInsideAString',
      'EmptyBody',
    ]);
    expect(names(declarations)).not.toContain('Helper');
  });

  it('keeps [Theory] and both [InlineData] rows in the snippet', () => {
    const code = snippet(text, find(declarations, 'Divide_ReturnsQuotient'));
    expect(code).toContain('[Theory]');
    expect(code).toContain('[InlineData(10, 2, 5)]');
    expect(code).toContain('[InlineData(9, 3, 3)]');
  });

  it('keeps angle brackets in generic assertions', () => {
    expect(find(declarations, 'Divide_ByZero_Throws').bodyText).toContain(
      'Assert.Throws<DivideByZeroException>',
    );
  });

  it('records Skip and DisplayName attributes as markers', () => {
    expect(find(declarations, 'Parked').markers).toEqual(['[Fact(Skip = "not implemented yet")]']);
    expect(find(declarations, 'DisplayNamed').markers).toEqual([
      '[Fact(DisplayName = "adds two and three")]',
    ]);
  });

  it('captures an expression body', () => {
    expect(find(declarations, 'ExpressionBodied').bodyText).toBe(
      'Assert.Equal(2, new Calculator().Add(1, 1))',
    );
  });

  it('brace-matches past a verbatim string containing a brace', () => {
    expect(find(declarations, 'BraceInsideAString').bodyText).toContain('Assert.Contains');
  });

  it('assigns the class as container, ignoring the namespace', () => {
    expect(find(declarations, 'Add_ReturnsSum').container).toBe('CalculatorTests');
  });
});

describe('sliceLines', () => {
  const text = 'one\ntwo\nthree\nfour\n';

  it('slices an inclusive 1-based line range without a trailing newline', () => {
    expect(sliceLines(text, 2, 3)).toBe('two\nthree');
    expect(sliceLines(text, 1, 1)).toBe('one');
  });

  it('clamps to the end of the text', () => {
    expect(sliceLines(text, 4, 99)).toBe('four');
  });
});
