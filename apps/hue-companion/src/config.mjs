import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const configPath = process.env.NEXTGEN_HUE_CONFIG || resolve(appRoot, ".local", "config.json");

export async function loadConfig() {
  const raw = await readFile(configPath, "utf8");
  const value = JSON.parse(raw);
  validateConfig(value);
  return value;
}

export async function saveConfig(value) {
  validateConfig(value);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function validateConfig(value) {
  const agents = ["pathfinder", "creator", "thinker", "connector"];
  if (!value || typeof value !== "object" || typeof value.bridgeIp !== "string" ||
      typeof value.applicationKey !== "string" || typeof value.certificateFingerprint !== "string") {
    throw new Error("Hue 설정 파일 형식이 올바르지 않습니다.");
  }
  if (!value.targets || agents.some((agentId) => typeof value.targets[agentId] !== "string")) {
    throw new Error("네 선배의 Hue 전구 매핑이 필요합니다.");
  }
}
