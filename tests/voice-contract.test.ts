import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VOICE_PROFILES,
  buildLiveInstructions,
  handleVoiceRoute,
  normalizeProfile
} from "../apps/worker/src/voice";
import type { Env } from "../apps/worker/src/index";
import { stripWakePrefix } from "../apps/web/src/voice";

test("wake prefix accepts spacing and strips punctuation", () => {
  assert.equal(stripWakePrefix("현자님, 진로가 고민돼요."), "진로가 고민돼요.");
  assert.equal(stripWakePrefix("현자 님 무엇부터 해야 할까요?"), "무엇부터 해야 할까요?");
  assert.equal(stripWakePrefix("친구와 나눈 주변 대화"), null);
});

test("invalid voice profile values fall back to safe defaults", () => {
  const fallback = DEFAULT_VOICE_PROFILES.pathfinder;
  const profile = normalizeProfile({ voiceId: "unknown", model: "", enabled: false }, "pathfinder", fallback);
  assert.equal(profile.voiceId, "cedar");
  assert.equal(profile.model, "gpt-live-1");
  assert.equal(profile.enabled, false);
});

test("live prompt requires backend delegation for mentor answers", () => {
  const prompt = buildLiveInstructions("thinker", DEFAULT_VOICE_PROFILES.thinker, "tap_vad");
  assert.match(prompt, /mentor_reply/);
  assert.match(prompt, /반드시 client backend에 위임/);
  assert.match(prompt, /받은 문장 그대로/);
  assert.match(prompt, /한국어/);
});

test("wake mode prompt ignores speech without the prefix", () => {
  const prompt = buildLiveInstructions("connector", DEFAULT_VOICE_PROFILES.connector, "wake_prefix");
  assert.match(prompt, /현자님/);
  assert.match(prompt, /주변 대화에는 침묵/);
});

const baseVoiceEnv: Env = {
  ALLOWED_ORIGIN: "https://app.example.test",
  VOICE_ENABLED: "true",
  OPENAI_API_KEY: "server-only-test-key",
  OPENAI_LIVE_MODEL: "gpt-live-1"
};

async function voiceRequest(path: string, init: RequestInit, env: Env = baseVoiceEnv) {
  const request = new Request(`https://worker.example.test${path}`, {
    ...init,
    headers: {
      Origin: "https://app.example.test",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });
  return handleVoiceRoute(request, env, new URL(request.url));
}

test("voice API rejects untrusted origins including preflight", async () => {
  for (const method of ["OPTIONS", "POST"]) {
    const request = new Request("https://worker.example.test/api/voice/session", {
      method,
      headers: { Origin: "https://attacker.example.test" },
      body: method === "POST" ? JSON.stringify({}) : undefined
    });
    const response = await handleVoiceRoute(request, baseVoiceEnv, new URL(request.url));
    assert.equal(response?.status, 403);
    assert.equal((await response?.json() as { error?: string }).error, "forbidden_origin");
  }
});

test("voice feature flag and agent validation fail before provider calls", async () => {
  const disabled = await voiceRequest("/api/voice/session", {
    method: "POST",
    body: JSON.stringify({ agentId: "pathfinder", conversationId: "c1", sdp: "offer" })
  }, { ...baseVoiceEnv, VOICE_ENABLED: "false" });
  assert.equal(disabled?.status, 503);

  const invalidAgent = await voiceRequest("/api/voice/session", {
    method: "POST",
    body: JSON.stringify({ agentId: "unknown", conversationId: "c1", sdp: "offer" })
  });
  assert.equal(invalidAgent?.status, 400);
});

test("live session proxy keeps the long-lived API key on the server", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl = "";
  let upstreamAuthorization = "";
  let upstreamBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    upstreamUrl = String(input);
    upstreamAuthorization = new Headers(init?.headers).get("Authorization") || "";
    upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      session: { id: "live_session_test" },
      transport: { type: "webrtc", sdp: "answer-sdp" }
    });
  };
  try {
    const response = await voiceRequest("/api/voice/session", {
      method: "POST",
      body: JSON.stringify({
        agentId: "pathfinder",
        conversationId: "conversation-1",
        activationMode: "tap_vad",
        sdp: "offer-sdp"
      })
    }, {
      ...baseVoiceEnv,
      SUPABASE_FUNCTIONS_URL: "https://stale-proxy.example.test/functions/v1",
      NEXTGEN_PROXY_SECRET: "proxy-secret"
    });
    assert.equal(response?.status, 200);
    assert.equal(upstreamUrl, "https://api.openai.com/v1/live/sessions");
    assert.equal(upstreamAuthorization, "Bearer server-only-test-key");
    assert.equal((upstreamBody.session as { model?: string }).model, "gpt-live-1");
    assert.equal("store" in (upstreamBody.session as Record<string, unknown>), false);
    assert.deepEqual(upstreamBody.transport, { type: "webrtc", sdp: "offer-sdp" });
    assert.doesNotMatch(await response!.text(), /server-only-test-key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin login issues an eight-hour hardened cookie without exposing secrets", async () => {
  const response = await voiceRequest("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: "correct horse battery staple" })
  }, {
    ...baseVoiceEnv,
    VOICE_ADMIN_PASSWORD: "correct horse battery staple",
    VOICE_ADMIN_SESSION_SECRET: "0123456789abcdef0123456789abcdef"
  });
  assert.equal(response?.status, 200);
  const cookie = response?.headers.get("Set-Cookie") || "";
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Max-Age=28800/i);
  assert.doesNotMatch(cookie, /correct horse battery staple/);
});

test('admin session endpoint accepts only a signed login cookie', async () => {
  const env = { ...baseVoiceEnv, VOICE_ADMIN_PASSWORD: 'correct horse battery staple', VOICE_ADMIN_SESSION_SECRET: '0123456789abcdef0123456789abcdef' };
  const denied = await voiceRequest('/api/admin/session', { method: 'GET' }, env);
  assert.equal(denied?.status, 401);
  const login = await voiceRequest('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: env.VOICE_ADMIN_PASSWORD }) }, env);
  const cookie = login!.headers.get('Set-Cookie')!.split(';')[0];
  const accepted = await voiceRequest('/api/admin/session', { method: 'GET', headers: { Cookie: cookie } }, env);
  assert.deepEqual(await accepted!.json(), { authenticated: true });
  const forged = await voiceRequest('/api/admin/session', { method: 'GET', headers: { Cookie: cookie + 'tampered' } }, env);
  assert.equal(forged?.status, 401);
});
