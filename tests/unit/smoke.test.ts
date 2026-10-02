import { test, expect } from 'vitest';
import { MAX_DIFF_BYTES, DEFAULT_ORG } from '../../src/shared/types';

test('constants', () => {
  expect(MAX_DIFF_BYTES).toBe(2097152);
  expect(DEFAULT_ORG).toBe(''); // aucune organisation imposée : saisie au premier lancement
});
