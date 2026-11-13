import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import lv from '../src/i18n/lv.json';
import en from '../src/i18n/en.json';
import ru from '../src/i18n/ru.json';
import lt from '../src/i18n/lt.json';
import et from '../src/i18n/et.json';

const ALL: Record<string, Record<string, string>> = { lv, en, ru, lt, et };
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('tulkojumi', () => {
  it.each(Object.keys(ALL))('%s: tās pašas atslēgas kā latviešu', (code) => {
    expect(Object.keys(ALL[code]).sort()).toEqual(Object.keys(lv).sort());
  });

  it.each(Object.keys(ALL))('%s: tie paši {parametri}, nav tukšu tekstu', (code) => {
    for (const [k, v] of Object.entries(lv)) {
      expect(params(ALL[code][k]), `${code} ${k}`).toBe(params(v));
      expect(ALL[code][k].trim().length, `${code} ${k}`).toBeGreaterThan(0);
    }
  });

  it.each(Object.keys(ALL))('%s: apraksts veikalam ≤132 simboli', (code) => {
    expect(ALL[code]['ext.desc'].length).toBeLessThanOrEqual(132);
    expect(ALL[code]['ext.name'].length).toBeLessThanOrEqual(75);
  });

  it('katram dzinēja iemeslam ir tulkojums', () => {
    const src = readFileSync('src/core/engine.ts', 'utf8');
    const codes = new Set([...src.matchAll(/this\.reason\('([a-z-]+)'/g), ...src.matchAll(/\[\d+, '([a-z-]+)'\]/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThan(10);
    for (const c of codes) expect(lv, c).toHaveProperty(`reason.${c}`);
  });
});
