import { describe, expect, it } from 'vitest';
import {
  NO_SUITE,
  folderItemId,
  suiteDescription,
  suiteItemId,
  suiteKey,
  suiteLabel,
  testItemId,
} from '../../../src/ui/testTree';

describe('testTree ids', () => {
  it('namespaces suites and tests under their folder', () => {
    expect(folderItemId('/work/proj')).toBe('/work/proj');
    expect(suiteItemId('/work/proj', 'com.pkg.FooTest')).toBe('/work/proj::com.pkg.FooTest');
    expect(testItemId('/work/proj', 'com.pkg.FooTest', 'addsUp')).toBe(
      '/work/proj::com.pkg.FooTest::addsUp',
    );
  });

  it('keeps ids distinct for same-named suites in different folders', () => {
    expect(suiteItemId('/a', 'FooTest')).not.toBe(suiteItemId('/b', 'FooTest'));
  });
});

describe('suiteKey', () => {
  it('falls back to a placeholder for missing or blank suites', () => {
    expect(suiteKey(undefined)).toBe(NO_SUITE);
    expect(suiteKey('   ')).toBe(NO_SUITE);
  });

  it('trims a real suite name', () => {
    expect(suiteKey(' com.pkg.FooTest ')).toBe('com.pkg.FooTest');
  });
});

describe('suiteLabel', () => {
  it('shows only the class name for a fully-qualified suite', () => {
    expect(suiteLabel('com.pkg.FooTest')).toBe('FooTest');
    expect(suiteDescription('com.pkg.FooTest')).toBe('com.pkg.FooTest');
  });

  it('leaves an unqualified suite alone and adds no redundant description', () => {
    expect(suiteLabel('FooTest')).toBe('FooTest');
    expect(suiteDescription('FooTest')).toBeUndefined();
  });

  it('does not blank out a suite name that ends in a dot', () => {
    expect(suiteLabel('FooTest.')).toBe('FooTest.');
  });
});
