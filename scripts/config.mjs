import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export function parseVars(raw) {
  return Object.fromEntries(raw.split(/\r\n|\n|\r/).filter(line => /^\s*[A-Z][A-Z0-9_]*\s*=/.test(line)).map(line => {
    const index = line.indexOf('=');
    const rawValue = line.slice(index + 1).trim();
    return [line.slice(0, index).trim(), /^(["']).*\1$/.test(rawValue) ? rawValue.slice(1, -1) : rawValue];
  }));
}
export async function readVars(file = 'apps/worker/.dev.vars') { return parseVars(await readFile(file, 'utf8')); }
export async function atomicWrite(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
}
export async function updateVars(patch, file = 'apps/worker/.dev.vars') {
  let raw = await readFile(file, 'utf8').catch(() => '');
  raw = raw.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  for (const [key, value] of Object.entries(patch)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) throw new Error('Invalid environment setting');
    const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'gm');
    if (pattern.test(raw)) raw = raw.replace(pattern, () => `${key}=${value}`);
    else raw += `${raw.endsWith('\n') || !raw ? '' : '\n'}${key}=${value}\n`;
  }
  await atomicWrite(file, raw);
}
export function isConfigured(value) { return Boolean(value && !/your-key|your-vector|replace-with|^<.*>$/.test(value)); }
