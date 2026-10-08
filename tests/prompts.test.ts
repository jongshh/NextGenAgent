import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PROMPT_SETTINGS, normalizePromptSettings, renderPrompt } from '@nextgen/agents';
import { buildInstructions } from '../apps/worker/src/index';
import { buildLiveInstructions, DEFAULT_VOICE_PROFILES, handleVoiceRoute } from '../apps/worker/src/voice';
import { loadPromptSettings } from '../apps/worker/src/prompts';

test('default text and voice prompts use the sage name and distinct editable personalities', () => {
  for (const id of ['pathfinder', 'creator', 'thinker', 'connector'] as const) {
    const text = buildInstructions(id, 'low', [], DEFAULT_PROMPT_SETTINGS);
    const live = buildLiveInstructions(id, DEFAULT_VOICE_PROFILES[id], 'tap_vad');
    assert.doesNotMatch(text + live, /선배|\{\{/);
    assert.ok(text.includes(DEFAULT_PROMPT_SETTINGS.agents[id].personality));
    assert.ok(live.includes(DEFAULT_PROMPT_SETTINGS.agents[id].personality));
    assert.match(live, /client backend/);
  }
});
test('all prompt fields are editable and labels normalize without recursively rendering inserted data', () => {
  const settings = structuredClone(DEFAULT_PROMPT_SETTINGS);
  settings.commonPrompt = '친근한 선배 역할';
  settings.agents.creator.personality = '유쾌한 상상가';
  settings.livePrompt = '나의 음성 지침 {{personality}} {{activation}}';
  settings.activation.tap_vad = '발화 종료 후 기다린다';
  const normalized = normalizePromptSettings(settings);
  assert.equal(normalized.commonPrompt, '친근한 현자 역할');
  assert.match(buildInstructions('creator', 'low', [], normalized), /유쾌한 상상가/);
  assert.match(buildLiveInstructions('creator', DEFAULT_VOICE_PROFILES.creator, 'tap_vad', false, normalized), /나의 음성 지침 유쾌한 상상가 발화 종료 후 기다린다/);
  assert.equal(renderPrompt('{{personality}}', { personality: '{{title}}' }), '{{title}}');
  assert.throws(() => normalizePromptSettings({ ...settings, livePrompt: '{{unknown}}' }));
  assert.throws(() => normalizePromptSettings({ ...settings, commonPrompt: '' }));
});
test('remote prompt loading fails explicitly instead of silently replacing saved prompts', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  try {
    await assert.rejects(loadPromptSettings({ SUPABASE_FUNCTIONS_URL: 'https://project.test/functions/v1', NEXTGEN_PROXY_SECRET: 'server-secret' }));
    assert.equal((await loadPromptSettings({})).persistent, false);
  } finally { globalThis.fetch = original; }
});
test('prompt admin endpoint rejects unauthenticated reads and writes', async () => {
  for (const method of ['GET', 'PUT']) {
    const request = new Request('https://worker.test/api/admin/prompts', { method, headers: { Origin: 'https://worker.test' } });
    const response = await handleVoiceRoute(request, {}, new URL(request.url));
    assert.equal(response?.status, 401);
  }
});

test('creating a live session reads saved prompt configuration before requesting OpenAI', async () => {
  const settings = structuredClone(DEFAULT_PROMPT_SETTINGS);
  settings.agents.pathfinder.personality = '저장된 현실적인 현자 성격';
  let instructions = '';
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/voice-profile-api')) {
      const body = JSON.parse(String(init?.body));
      return Response.json(body.action === 'list' ? { profiles: [] } : { configuration: settings, version: 3 });
    }
    instructions = JSON.parse(String(init?.body)).session.instructions;
    return Response.json({ session: { id: 'test' }, transport: { sdp: 'answer' } }, { status: 201 });
  };
  try {
    const request = new Request('https://worker.test/api/voice/session', { method: 'POST', headers: { Origin: 'https://worker.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: 'pathfinder', conversationId: 'test', sdp: 'offer' }) });
    const response = await handleVoiceRoute(request, { VOICE_ENABLED: 'true', OPENAI_API_KEY: 'server-key', SUPABASE_FUNCTIONS_URL: 'https://project.test/functions/v1', NEXTGEN_PROXY_SECRET: 'proxy-secret' }, new URL(request.url));
    assert.equal(response?.status, 201);
    assert.match(instructions, /저장된 현실적인 현자 성격/);
  } finally { globalThis.fetch = original; }
});
