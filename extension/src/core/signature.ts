function b64(s: string): Uint8Array {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Pārbauda bāzes Ed25519 parakstu (WebCrypto: Chrome 137+, Firefox 129+). */
export async function verifyBundle(data: Uint8Array, sigB64: string, pubB64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', b64(pubB64) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, b64(sigB64) as BufferSource, data as BufferSource);
  } catch (e) {
    console.warn('URLguard: paraksta pārbaude neizdevās', e);
    return false;
  }
}
