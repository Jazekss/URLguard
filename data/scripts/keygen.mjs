#!/usr/bin/env node
// Ģenerē Ed25519 atslēgu pāri bāzes parakstīšanai.
//  - privātā: <repo>/.keys/signing-private.pem  (gitignored -> ieliec GitHub Secret URLGUARD_SIGNING_KEY)
//  - publiskā: data/keys/public.b64             (commitojama, tiek iebūvēta paplašinājumā)
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ROOT_DIR } from './lib.mjs';

const privPath = join(ROOT_DIR, '.keys', 'signing-private.pem');
if (existsSync(privPath) && !process.argv.includes('--force')) {
  console.error(`${privPath} jau eksistē. Lieto --force, ja tiešām gribi jaunu (vecie paplašinājumi vairs nepieņems bāzi!).`);
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
mkdirSync(join(ROOT_DIR, '.keys'), { recursive: true });
writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
mkdirSync(join(DATA_DIR, 'keys'), { recursive: true });
writeFileSync(join(DATA_DIR, 'keys', 'public.b64'), raw.toString('base64') + '\n');
console.log('Privātā atslēga:', privPath);
console.log('Publiskā atslēga (data/keys/public.b64):', raw.toString('base64'));
console.log('Ieliec privātās atslēgas PEM saturu GitHub Secret "URLGUARD_SIGNING_KEY".');
