import { test, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsStore } from '../../src/main/settings';
import { tempDir } from './helpers';

test('thème : système par défaut, mémorisé, valeurs invalides ignorées', () => {
  const file = join(tempDir(), 'settings.json');
  const s = new SettingsStore(file);
  expect(s.theme()).toBe('system');
  s.setTheme('dark');
  expect(new SettingsStore(file).theme()).toBe('dark');
  expect(() => s.setTheme('violet' as never)).toThrow();
  writeFileSync(file, '{"theme":"<script>"}');
  expect(new SettingsStore(file).theme()).toBe('system');
  writeFileSync(file, '{oops');
  expect(new SettingsStore(file).theme()).toBe('system');
});
