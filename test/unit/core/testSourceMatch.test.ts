import { describe, expect, it } from 'vitest';
import { matchDeclaration, normalizeTestName } from '../../../src/core/testSource';
import { declarations } from '../helpers/sourceFixtures';

const { python, java, kotlin, csharp } = declarations;

describe('normalizeTestName', () => {
  it.each([
    ['test_add_returns_sum', 'test_add_returns_sum'],
    ['test_divide_returns_quotient[10-2-5]', 'test_divide_returns_quotient'],
    ['addReturnsSum()', 'addReturnsSum'],
    // Surefire puts the parameter types and then the invocation index on the name.
    ['divideReturnsQuotient(int, int, int)[1]', 'divideReturnsQuotient'],
    ['CalculatorSample.Tests.CalculatorTests.Add_ReturnsSum', 'Add_ReturnsSum'],
    // Strip the argument list before the package prefix: dotnet arguments contain dots.
    ['Ns.Cls.Divide_ReturnsQuotient(a: 10, b: 2, expected: 5)', 'Divide_ReturnsQuotient'],
    ['Ns.Cls.Rounds(value: 1.5)', 'Rounds'],
    ['`adds two and three`', 'adds two and three'],
    // A display name is not a qualified name, so the dot must survive.
    ['adds 2.5 and 3', 'adds 2.5 and 3'],
    ['  padded  ', 'padded'],
  ])('normalizes %j to %j', (raw, expected) => {
    expect(normalizeTestName(raw)).toBe(expected);
  });
});

describe('matchDeclaration', () => {
  it.each([
    ['test_add_returns_sum', 'test_calculator', 'test_add_returns_sum', undefined],
    ['test_divide_returns_quotient[10-2-5]', 'test_calculator', 'test_divide_returns_quotient', undefined],
    ['test_divide_returns_quotient[9-3-3]', 'test_calculator', 'test_divide_returns_quotient', undefined],
  ])('python: %j in suite %j', (testName, suite, expectedName, expectedContainer) => {
    const hit = matchDeclaration(python, testName, suite);
    expect(hit?.name).toBe(expectedName);
    expect(hit?.container).toBe(expectedContainer);
  });

  it('uses the suite class to pick between same-named tests in different classes', () => {
    expect(matchDeclaration(python, 'test_add', 'tests.test_math.TestMath')?.container).toBe('TestMath');
    expect(matchDeclaration(python, 'test_add', 'tests.test_math.TestParked')?.container).toBe('TestParked');
  });

  it('java: strips surefire decoration and finds the method', () => {
    expect(matchDeclaration(java, 'addReturnsSum()', 'com.example.calculator.CalculatorTest')?.name).toBe(
      'addReturnsSum',
    );
    expect(
      matchDeclaration(java, 'divideReturnsQuotient(int, int, int)[1]', 'com.example.calculator.CalculatorTest')
        ?.name,
    ).toBe('divideReturnsQuotient');
  });

  it('java: resolves a @DisplayName that normalization cannot recover', () => {
    expect(matchDeclaration(java, 'adds two and three', 'com.example.calculator.CalculatorTest')?.name).toBe(
      'displayNamed',
    );
  });

  it('java: uses a $-separated nested suite to disambiguate', () => {
    const suite = 'com.example.calculator.CalculatorTest$InnerCases';
    expect(matchDeclaration(java, 'ambiguous', suite)?.container).toBe('CalculatorTest.InnerCases');
  });

  it('java: refuses to guess when the name is ambiguous and the suite does not help', () => {
    expect(matchDeclaration(java, 'ambiguous', undefined)).toBeUndefined();
  });

  it('java: breaks an ambiguous tie with a stack-trace line when one is available', () => {
    const inner = java.filter((declaration) => declaration.name === 'ambiguous')[1];
    expect(matchDeclaration(java, 'ambiguous', undefined, inner.startLine)?.container).toBe(
      'CalculatorTest.OtherCases',
    );
  });

  it('kotlin: matches a backticked function name', () => {
    expect(matchDeclaration(kotlin, 'adds two and three', 'com.example.calculator.CalculatorTest')?.name).toBe(
      'adds two and three',
    );
  });

  it('csharp: strips the namespace and the theory arguments', () => {
    const suite = 'CalculatorSample.Tests.CalculatorTests';
    expect(matchDeclaration(csharp, `${suite}.Add_ReturnsSum`, suite)?.name).toBe('Add_ReturnsSum');
    expect(
      matchDeclaration(csharp, `${suite}.Divide_ReturnsQuotient(a: 10, b: 2, expected: 5)`, suite)?.name,
    ).toBe('Divide_ReturnsQuotient');
  });

  it('returns undefined for a name that is not in the file', () => {
    expect(matchDeclaration(java, 'totallyUnknown', 'com.example.calculator.CalculatorTest')).toBeUndefined();
    expect(matchDeclaration([], 'anything', undefined)).toBeUndefined();
  });

  it('falls back to a case-insensitive match', () => {
    expect(matchDeclaration(java, 'ADDRETURNSSUM', 'com.example.calculator.CalculatorTest')?.name).toBe(
      'addReturnsSum',
    );
  });
});
