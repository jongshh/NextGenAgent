import { DEFAULT_PROMPT_SETTINGS, normalizePromptSettings, type PromptSettings } from '@nextgen/agents';
import type { Env } from './index';

export function hasPromptBackend(env: Env) { return Boolean(env.SUPABASE_FUNCTIONS_URL?.trim() && env.NEXTGEN_PROXY_SECRET?.trim()); }
export async function promptApi(payload: unknown, env: Env): Promise<Response> {
  return fetch(`${env.SUPABASE_FUNCTIONS_URL!.trim().replace(/\/$/, '')}/voice-profile-api`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nextgen-proxy-secret': env.NEXTGEN_PROXY_SECRET! },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(8000)
  });
}
export async function loadPromptSettings(env: Env): Promise<{ settings: PromptSettings; version: number; persistent: boolean }> {
  if (!hasPromptBackend(env)) return { settings: structuredClone(DEFAULT_PROMPT_SETTINGS), version: 0, persistent: false };
  const response = await promptApi({ action: 'prompts-load' }, env);
  if (!response.ok) throw new Error('프롬프트 저장소에 연결하지 못했습니다.');
  const payload = await response.json() as { configuration?: unknown; version?: number };
  return { settings: payload.configuration ? normalizePromptSettings(payload.configuration) : structuredClone(DEFAULT_PROMPT_SETTINGS), version: payload.version || 0, persistent: true };
}
