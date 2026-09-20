import { describe, expect, it } from 'vitest';
import { analyzeDeclaration, unlocatedIntegrity } from '../../../src/capture/integrity';
import type { SourceLanguage, TestDeclaration } from '../../../src/source';
import { declarationNamed, declarations } from '../helpers/sourceFixtures';

const { python, java, kotlin, csharp } = declarations;

function analyze(found: TestDeclaration[], name: string, language: SourceLanguage) {
  return analyzeDeclaration(declarationNamed(found, name), language);
}

describe('analyzeDeclaration — python', () => {
  it('counts bare asserts', () => {
    expect(analyze(python, 'test_add_returns_sum', 'python').assertionCount).toBe(1);
  });

  it('counts pytest.raises as an assertion', () => {
    expect(analyze(python, 'test_divide_by_zero', 'python').assertionCount).toBe(1);
  });

  it('flags a pass-only body as empty with no assertions', () => {
    expect(analyze(python, 'test_empty_body', 'python')).toMatchObject({
      located: true,
      empty: true,
      assertionCount: 0,
    });
  });

  it('flags a docstring-only body as empty', () => {
    expect(analyze(python, 'test_only_a_docstring', 'python')).toMatchObject({
      empty: true,
      assertionCount: 0,
    });
  });

  it('reads a skip decorator on the test', () => {
    expect(analyze(python, 'test_skipped_outright', 'python')).toMatchObject({
      skipMarker: '@pytest.mark.skip(reason="not implemented yet")',
    });
  });

  it('reads a skip decorator inherited from the class', () => {
    const parked = python.filter((d) => d.name === 'test_add' && d.container === 'TestParked');
    expect(analyzeDeclaration(parked[0], 'python')).toMatchObject({
      skipMarker: '@pytest.mark.skip(reason="whole class parked")',
    });
  });

  it('does not double-count self.assertX as a bare assert', () => {
    const declaration: TestDeclaration = {
      name: 'test_x',
      startLine: 1,
      endLine: 2,
      markers: [],
      containerMarkers: [],
      bodyText: 'self.assertEqual(1, 1)',
    };
    expect(analyzeDeclaration(declaration, 'python').assertionCount).toBe(1);
  });

  it('ignores an assert that only appears in a comment or a string', () => {
    const declaration: TestDeclaration = {
      name: 'test_x',
      startLine: 1,
      endLine: 3,
      markers: [],
      containerMarkers: [],
      bodyText: '# assert 1 == 2\nvalue = "assert 3 == 4"\n',
    };
    expect(analyzeDeclaration(declaration, 'python').assertionCount).toBe(0);
  });
});

describe('analyzeDeclaration — java and kotlin', () => {
  it('counts assertEquals and assertThrows', () => {
    expect(analyze(java, 'addReturnsSum', 'java').assertionCount).toBe(1);
    expect(analyze(java, 'throwsOnDivideByZero', 'java').assertionCount).toBe(1);
  });

  it('flags an empty method body', () => {
    expect(analyze(java, 'emptyBody', 'java')).toMatchObject({ empty: true, assertionCount: 0 });
    expect(analyze(kotlin, 'emptyBody', 'kotlin')).toMatchObject({ empty: true, assertionCount: 0 });
  });

  it('reads @Disabled as a skip marker', () => {
    expect(analyze(java, 'parkedTest', 'java')).toMatchObject({
      skipMarker: '@Disabled("parked")',
    });
  });

  it('leaves an ordinary test unmarked', () => {
    expect(analyze(java, 'addReturnsSum', 'java')).toMatchObject({
      skipMarker: undefined,
      empty: false,
    });
  });

  it('counts an assertion in a Kotlin expression body', () => {
    expect(analyze(kotlin, 'expressionBodied', 'kotlin').assertionCount).toBe(1);
  });

  it('does not count an assertEquals that only appears in a comment', () => {
    const declaration: TestDeclaration = {
      name: 'x',
      startLine: 1,
      endLine: 2,
      markers: [],
      containerMarkers: [],
      bodyText: '// assertEquals(1, 2);\nint x = 1;',
    };
    expect(analyzeDeclaration(declaration, 'java').assertionCount).toBe(0);
    expect(analyzeDeclaration(declaration, 'java').empty).toBe(false);
  });
});

describe('analyzeDeclaration — csharp', () => {
  it('counts Assert.Equal', () => {
    expect(analyze(csharp, 'Add_ReturnsSum', 'csharp').assertionCount).toBe(1);
  });

  it('counts a generic Assert.Throws<T>', () => {
    expect(analyze(csharp, 'Divide_ByZero_Throws', 'csharp').assertionCount).toBe(1);
  });

  it('reads Skip = "…" on the attribute', () => {
    expect(analyze(csharp, 'Parked', 'csharp')).toMatchObject({
      skipMarker: '[Fact(Skip = "not implemented yet")]',
    });
  });

  it('does not treat DisplayName as a skip', () => {
    expect(analyze(csharp, 'DisplayNamed', 'csharp').skipMarker).toBeUndefined();
  });

  it('flags an empty body', () => {
    expect(analyze(csharp, 'EmptyBody', 'csharp')).toMatchObject({ empty: true, assertionCount: 0 });
  });
});

describe('unlocatedIntegrity', () => {
  it('reports only that the test could not be found', () => {
    expect(unlocatedIntegrity()).toEqual({ located: false });
  });
});
