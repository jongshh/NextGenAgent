import { readFile } from "node:fs/promises";
import { atomicWrite } from "../../../scripts/config.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateLightProfile } from './profiles.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const configPath = process.env.NEXTGEN_HUE_CONFIG || resolve(appRoot, ".local", "config.json");

export async function loadConfig() {
  const raw = await readFile(configPath, "utf8");
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error('Hue 설정 JSON이 손상되었습니다. 개발자 조명 탭에서 Bridge를 다시 등록하세요.'); }
  validateConfig(value);
  return value;
}

export async function saveConfig(value) {
  validateConfig(value);
  await atomicWrite(configPath, `${JSON.stringify(value, null, 2)}\n`);
}

function validateConfig(value) {
  const agents = ["pathfinder", "creator", "thinker", "connector"];
  if (value?.profiles !== undefined) {
    if (!value.profiles || typeof value.profiles !== 'object' || Array.isArray(value.profiles)) throw new Error('조명 프로필 형식이 올바르지 않습니다.');
    for (const [id, profile] of Object.entries(value.profiles)) {
      if (!agents.includes(id)) throw new Error('알 수 없는 현자 조명 프로필입니다.');
      validateLightProfile(profile);
    }
  }
  if (!value || typeof value !== "object" || typeof value.bridgeIp !== "string" || !value.bridgeIp ||
      typeof value.applicationKey !== "string" || !value.applicationKey || typeof value.certificateFingerprint !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(value.certificateFingerprint.replaceAll(':', ''))) {
    throw new Error("Hue 설정 파일 형식이 올바르지 않습니다.");
  }
  if (!value.targets || typeof value.targets !== 'object' || Array.isArray(value.targets) || Object.entries(value.targets).some(([id, target]) => !agents.includes(id) || typeof target !== 'string' || !target) ||
      new Set(Object.values(value.targets)).size !== Object.values(value.targets).length) {
    throw new Error("Hue 전구 매핑이 올바르지 않거나 중복되었습니다.");
  }
}
