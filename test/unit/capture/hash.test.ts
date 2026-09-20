import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../src/capture/hash';

describe('sha256Hex', () => {
  it('produces a 64-character lowercase hex digest', () => {
    const hash = sha256Hex('at Foo.bar(Foo.java:10)');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(sha256Hex('same input')).toBe(sha256Hex('same input'));
  });

  it('differs for different input', () => {
    expect(sha256Hex('input a')).not.toBe(sha256Hex('input b'));
  });
});
