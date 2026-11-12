export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Mazie burti, bez garumzīmēm, tikai [a-z0-9]. */
export function norm(s: string): string {
  return stripDiacritics(s.toLowerCase()).replace(/[^a-z0-9]/g, '');
}

/** Sadala pa ne-burtciparu simboliem: "swedbank-lv.com" -> [swedbank, lv, com]. */
export function tokens(s: string): string[] {
  return stripDiacritics(s.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Vizuāli līdzīgi simboli -> latīņu "skelets" (kirilica, grieķu, cipari).
const HOMOGLYPHS: Record<string, string> = {
  'а': 'a', 'е': 'e', 'ё': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ї': 'i',
  'ј': 'j', 'ԁ': 'd', 'ӏ': 'l', 'һ': 'h', 'ѕ': 's', 'ԛ': 'q', 'ԝ': 'w', 'к': 'k', 'м': 'm', 'т': 't',
  'в': 'b', 'ь': 'b', 'г': 'r', 'п': 'n', 'и': 'u', 'н': 'h', 'ɡ': 'g', 'ı': 'i', 'ł': 'l', 'ø': 'o',
  'đ': 'd', 'α': 'a', 'ο': 'o', 'ν': 'v', 'ρ': 'p', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'τ': 't', 'υ': 'u',
  'χ': 'x', 'β': 'b', '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g',
};

export function skeleton(s: string): string {
  let out = '';
  for (const ch of stripDiacritics(s.toLowerCase())) out += HOMOGLYPHS[ch] ?? ch;
  return out
    .replace(/[^a-z0-9]/g, '')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w');
}

/** Levenšteina attālums ar augšējo robežu (atgriež max+1, ja pārsniedz). */
export function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const NON_LATIN = /[Ͱ-ϿЀ-ӿԀ-ԯ]/;
const LATIN = /[a-z]/;

/** Vienā domēna daļā sajaukti latīņu un kirilicas/grieķu burti. */
export function hasMixedScript(label: string): boolean {
  const l = label.toLowerCase();
  return LATIN.test(l) && NON_LATIN.test(l);
}
