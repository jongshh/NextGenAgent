import { AGENTS, DEFAULT_PROMPT_SETTINGS, normalizePromptSettings, renderPrompt, getAgentConfig, isAgentId, type AgentId, type PromptSettings } from "@nextgen/agents";
import type { Env } from "./index";
import { hasPromptBackend, loadPromptSettings, promptApi } from './prompts';

export type VoiceId = "alloy" | "ash" | "ballad" | "coral" | "echo" | "sage" |
  "shimmer" | "verse" | "marin" | "cedar";
export type VoiceActivationMode = "tap_vad" | "wake_prefix" | "push_to_talk";
export type VoiceEagerness = "low" | "auto" | "high";

export interface VoiceProfile {
  agentId: AgentId;
  provider: "openai-live";
  model: string;
  voiceId: VoiceId;
  speakingInstructions: string;
  activationMode: VoiceActivationMode;
  eagerness: VoiceEagerness;
  previewText: string;
  enabled: boolean;
  version: number;
  updatedAt?: string;
}

interface VoiceSessionRequest {
  agentId?: string;
  conversationId?: string;
  sdp?: string;
  activationMode?: VoiceActivationMode;
  profile?: unknown;
}

const VOICES = new Set<VoiceId>([
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"
]);
const ACTIVATION_MODES = new Set<VoiceActivationMode>(["tap_vad", "wake_prefix", "push_to_talk"]);
const EAGERNESS = new Set<VoiceEagerness>(["low", "auto", "high"]);
const ADMIN_COOKIE = "nextgen_voice_admin";
const MAX_SDP_LENGTH = 65_536;
const ADMIN_TTL_SECONDS = 8 * 60 * 60;

export const DEFAULT_VOICE_PROFILES: Record<AgentId, VoiceProfile> = {
  pathfinder: defaultProfile("pathfinder", "cedar", "차분하고 든든하게, 생각할 여유를 주며 말한다."),
  creator: defaultProfile("creator", "coral", "생동감 있고 따뜻하게, 창작의 에너지를 살려 말한다."),
  thinker: defaultProfile("thinker", "marin", "낮고 침착한 호흡으로, 문장 사이에 생각할 틈을 둔다."),
  connector: defaultProfile("connector", "verse", "두려움을 인정하고 준비와 동료의 도움을 이야기하며, 차분하고 든든하게 말한다.")
};

export async function handleVoiceRoute(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/voice/") && !url.pathname.startsWith("/api/admin/")) {
    return null;
  }

  if (!isAllowedOrigin(request, env, url)) {
    return voiceJson(request, env, { error: "forbidden_origin" }, 403);
  }
  if (request.method === "OPTIONS") return new Response(null, { headers: voiceCorsHeaders(request, env) });

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    return handleAdminLogin(request, env);
  }
  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    return voiceJson(request, env, { ok: true }, 200, { "Set-Cookie": expiredAdminCookie(request) });
  }
  if (url.pathname === "/api/admin/auth-state" && request.method === "GET") {
    return voiceJson(request, env, { authenticated: await hasValidAdminSession(request, env) });
  }

  if (url.pathname.startsWith("/api/admin/")) {
    if (!(await hasValidAdminSession(request, env))) {
      return voiceJson(request, env, { error: "admin_auth_required" }, 401);
    }
    if (url.pathname === "/api/admin/session" && request.method === "GET") {
      return voiceJson(request, env, { authenticated: true });
    }
    if (url.pathname === '/api/admin/prompts' && request.method === 'GET') {
      try { return voiceJson(request, env, { ...await loadPromptSettings(env), defaults: DEFAULT_PROMPT_SETTINGS }); }
      catch { return voiceJson(request, env, { error: '프롬프트 저장소에 연결하지 못했습니다.' }, 503); }
    }
    if (url.pathname === '/api/admin/prompts' && request.method === 'PUT') {
      if (!hasPromptBackend(env)) return voiceJson(request, env, { error: '프롬프트 저장소가 연결되지 않았습니다.' }, 503);
      const body = await readJson<{ settings?: unknown; version?: number }>(request);
      let settings: PromptSettings;
      try {
        settings = normalizePromptSettings(body?.settings);
        if (!Number.isSafeInteger(body?.version) || body!.version! < 0) throw new Error('프롬프트 버전이 올바르지 않습니다.');
      } catch (error) { return voiceJson(request, env, { error: error instanceof Error ? error.message : '잘못된 프롬프트' }, 400); }
      try {
        const response = await promptApi({ action: 'prompts-save', configuration: settings, version: body!.version }, env);
        return new Response(await response.text(), { status: response.status, headers: { ...voiceCorsHeaders(request, env), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      } catch { return voiceJson(request, env, { error: '프롬프트를 저장하지 못했습니다.' }, 503); }
    }
    if (url.pathname === "/api/admin/voice-profiles" && request.method === "GET") {
      const profiles = await loadAllProfiles(env);
      return voiceJson(request, env, { profiles, persistent: hasProfileBackend(env) });
    }
    const match = url.pathname.match(/^\/api\/admin\/voice-profiles\/([^/]+)$/);
    if (match && request.method === "PUT") {
      return saveAdminProfile(request, env, match[1]);
    }
    if (url.pathname === "/api/admin/voice-preview-session" && request.method === "POST") {
      return createVoiceSession(request, env, true);
    }
    return voiceJson(request, env, { error: "not_found" }, 404);
  }

  if (!isVoiceEnabled(env)) {
    return voiceJson(request, env, { error: "voice_disabled", message: "음성 기능이 아직 활성화되지 않았어요." }, 503);
  }
  if (url.pathname === "/api/voice/session" && request.method === "POST") {
    return createVoiceSession(request, env, false);
  }
  if (/^\/api\/voice\/session\/[^/]+\/end$/.test(url.pathname) && request.method === "POST") {
    return voiceJson(request, env, { ok: true });
  }
  return voiceJson(request, env, { error: "not_found" }, 404);
}

async function createVoiceSession(request: Request, env: Env, preview: boolean): Promise<Response> {
  const body = await readJson<VoiceSessionRequest>(request);
  if (!body) return voiceJson(request, env, { error: "invalid_request" }, 400);
  if (!body.agentId || !isAgentId(body.agentId)) {
    return voiceJson(request, env, { error: "invalid_agent" }, 400);
  }
  if (typeof body.sdp !== "string" || !body.sdp.trim() || body.sdp.length > MAX_SDP_LENGTH) {
    return voiceJson(request, env, { error: "invalid_sdp" }, 400);
  }
  if (!preview && (typeof body.conversationId !== "string" || !body.conversationId.trim())) {
    return voiceJson(request, env, { error: "invalid_conversation" }, 400);
  }

  const saved = await loadProfile(body.agentId, env);
  let settings: PromptSettings;
  try { settings = (await loadPromptSettings(env)).settings; }
  catch { return voiceJson(request, env, { error: 'prompt_store_unavailable', message: '현자 프롬프트 저장소에 연결하지 못했습니다.' }, 503); }
  const requested = preview ? normalizeProfile(body.profile, body.agentId, saved) : saved;
  if (!requested.enabled) return voiceJson(request, env, { error: "voice_profile_disabled" }, 409);
  const activationMode = body.activationMode && ACTIVATION_MODES.has(body.activationMode)
    ? body.activationMode
    : requested.activationMode;

  const payload = {
    session: {
      model: env.OPENAI_LIVE_MODEL?.trim() || requested.model,
      instructions: buildLiveInstructions(body.agentId, requested, activationMode, preview, settings),
      audio: { output: { voice: requested.voiceId } },
      delegation: { type: "client" }
    },
    transport: { type: "webrtc", sdp: body.sdp },
    safetyIdentifier: await safetyIdentifier(body.conversationId || `preview-${body.agentId}`)
  };

  try {
    const upstream = await callOpenAIProxy("live_session", payload, env);
    const responseBody = await upstream.text();
    if (!upstream.ok) {
      const diagnostic = providerErrorDiagnostic(responseBody);
      console.error(JSON.stringify({
        event: "voice_session_create_failed",
        status: upstream.status,
        providerCode: diagnostic.code,
        providerParam: diagnostic.param
      }));
      return voiceJson(request, env, {
        error: "voice_session_rejected",
        message: diagnostic.message,
        providerCode: diagnostic.code,
        providerParam: diagnostic.param
      }, upstream.status);
    }
    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        ...voiceCorsHeaders(request, env),
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return voiceJson(request, env, { error: "voice_service_unavailable" }, 503);
  }
}

export function buildLiveInstructions(
  agentId: AgentId,
  profile: VoiceProfile,
  activationMode: VoiceActivationMode,
  preview = false,
  settings: PromptSettings = DEFAULT_PROMPT_SETTINGS
): string {
  const agent = getAgentConfig(agentId);
  const context = { title: agent.title, question: agent.question, ...settings.agents[agentId],
    speakingInstructions: profile.speakingInstructions.replaceAll('선배', '현자'),
    activation: settings.activation[activationMode], patience: settings.patience[profile.eagerness] };
  return [renderPrompt(settings.commonPrompt, context), renderPrompt(preview ? settings.previewPrompt : settings.livePrompt, context)].join('\n');
}

async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  if (!env.VOICE_ADMIN_PASSWORD?.trim() || !env.VOICE_ADMIN_SESSION_SECRET?.trim()) {
    return voiceJson(request, env, { error: "admin_not_configured" }, 503);
  }
  const body = await readJson<{ password?: string }>(request);
  const ipHash = await safetyIdentifier(request.headers.get("CF-Connecting-IP") || "local");
  const limited = await isLoginRateLimited(ipHash);
  if (limited) return voiceJson(request, env, { error: "too_many_attempts" }, 429);
  const valid = typeof body?.password === "string" &&
    await secureEqual(body.password, env.VOICE_ADMIN_PASSWORD);
  if (!valid) {
    await recordLoginFailure(ipHash);
    return voiceJson(request, env, { error: "invalid_password" }, 401);
  }
  await clearLoginFailures(ipHash);
  const cookie = await createAdminCookie(request, env.VOICE_ADMIN_SESSION_SECRET);
  return voiceJson(request, env, { ok: true }, 200, { "Set-Cookie": cookie });
}

async function saveAdminProfile(request: Request, env: Env, rawAgentId: string): Promise<Response> {
  if (!isAgentId(rawAgentId)) return voiceJson(request, env, { error: "invalid_agent" }, 400);
  const body = await readJson<unknown>(request);
  const profile = normalizeProfile(body, rawAgentId, DEFAULT_VOICE_PROFILES[rawAgentId]);
  if (!isProfileInput(body)) return voiceJson(request, env, { error: "invalid_voice_profile" }, 400);
  if (!hasProfileBackend(env)) return voiceJson(request, env, { error: "profile_store_unavailable" }, 503);
  const response = await invokeProfileApi({ action: "save", profile }, env);
  const payload = await response.text();
  return new Response(payload, {
    status: response.status,
    headers: { ...voiceCorsHeaders(request, env), "Content-Type": "application/json; charset=utf-8" }
  });
}

async function loadAllProfiles(env: Env): Promise<VoiceProfile[]> {
  if (!hasProfileBackend(env)) return Object.values(DEFAULT_VOICE_PROFILES);
  try {
    const response = await invokeProfileApi({ action: "list" }, env);
    if (!response.ok) return Object.values(DEFAULT_VOICE_PROFILES);
    const payload = await response.json() as { profiles?: unknown[] };
    const rows = new Map((payload.profiles || []).map((item) => {
      const record = item as Record<string, unknown>;
      return [record.agentId, item];
    }));
    return (Object.keys(AGENTS) as AgentId[]).map((agentId) =>
      normalizeProfile(rows.get(agentId), agentId, DEFAULT_VOICE_PROFILES[agentId])
    );
  } catch {
    return Object.values(DEFAULT_VOICE_PROFILES);
  }
}

async function loadProfile(agentId: AgentId, env: Env): Promise<VoiceProfile> {
  const profiles = await loadAllProfiles(env);
  return profiles.find((profile) => profile.agentId === agentId) || DEFAULT_VOICE_PROFILES[agentId];
}

export function normalizeProfile(value: unknown, agentId: AgentId, fallback: VoiceProfile): VoiceProfile {
  if (!value || typeof value !== "object") return { ...fallback };
  const row = value as Record<string, unknown>;
  const voiceId = typeof row.voiceId === "string" && VOICES.has(row.voiceId as VoiceId)
    ? row.voiceId as VoiceId
    : fallback.voiceId;
  const activationMode = typeof row.activationMode === "string" && ACTIVATION_MODES.has(row.activationMode as VoiceActivationMode)
    ? row.activationMode as VoiceActivationMode
    : fallback.activationMode;
  const eagerness = typeof row.eagerness === "string" && EAGERNESS.has(row.eagerness as VoiceEagerness)
    ? row.eagerness as VoiceEagerness
    : fallback.eagerness;
  return {
    agentId,
    provider: "openai-live",
    model: cleanString(row.model, fallback.model, 80),
    voiceId,
    speakingInstructions: cleanString(row.speakingInstructions, fallback.speakingInstructions, 600).replaceAll('선배', '현자'),
    activationMode,
    eagerness,
    previewText: cleanString(row.previewText, fallback.previewText, 300),
    enabled: typeof row.enabled === "boolean" ? row.enabled : fallback.enabled,
    version: typeof row.version === "number" && Number.isInteger(row.version) ? Math.max(1, row.version) : fallback.version,
    ...(typeof row.updatedAt === "string" ? { updatedAt: row.updatedAt } : {})
  };
}

function isProfileInput(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.voiceId === "string" && VOICES.has(row.voiceId as VoiceId) &&
    typeof row.model === "string" && row.model.trim().length > 0 &&
    typeof row.speakingInstructions === "string" &&
    typeof row.enabled === "boolean";
}

function defaultProfile(agentId: AgentId, voiceId: VoiceId, speakingInstructions: string): VoiceProfile {
  return {
    agentId,
    provider: "openai-live",
    model: "gpt-live-1",
    voiceId,
    speakingInstructions,
    activationMode: "tap_vad",
    eagerness: "auto",
    previewText: "반가워요. 서두르지 말고, 지금 마음에 있는 이야기부터 들려주세요.",
    enabled: true,
    version: 1
  };
}

function cleanString(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function isVoiceEnabled(env: Env): boolean {
  return env.VOICE_ENABLED?.trim().toLowerCase() === "true";
}

function hasProfileBackend(env: Env): boolean {
  return Boolean(env.SUPABASE_FUNCTIONS_URL?.trim() && env.NEXTGEN_PROXY_SECRET?.trim());
}

async function callOpenAIProxy(operation: "live_session", payload: unknown, env: Env): Promise<Response> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const record = payload as { safetyIdentifier?: string; session: unknown; transport: unknown };
  if (apiKey) {
    return fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": record.safetyIdentifier || "nga_anonymous"
      },
      body: JSON.stringify({ session: record.session, transport: record.transport })
    });
  }

  const base = env.SUPABASE_FUNCTIONS_URL?.trim().replace(/\/$/, "");
  const secret = env.NEXTGEN_PROXY_SECRET?.trim();
  if (base && secret) {
    return fetch(`${base}/openai-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nextgen-proxy-secret": secret },
      body: JSON.stringify({ operation, payload })
    });
  }
  throw new Error("OpenAI is not configured");
}

function providerErrorDiagnostic(responseBody: string): { message: string; code: string; param: string } {
  let message = "음성 API가 세션 요청을 거부했습니다.";
  let code = "unknown";
  let param = "";
  try {
    const payload = JSON.parse(responseBody) as {
      error?: string | { message?: unknown; code?: unknown; type?: unknown; param?: unknown };
      message?: unknown;
    };
    if (typeof payload.error === "string") {
      code = payload.error.slice(0, 80);
    } else if (payload.error && typeof payload.error === "object") {
      if (typeof payload.error.code === "string") code = payload.error.code.slice(0, 80);
      else if (typeof payload.error.type === "string") code = payload.error.type.slice(0, 80);
      if (typeof payload.error.param === "string") param = payload.error.param.slice(0, 120);
      if (typeof payload.error.message === "string") message = payload.error.message.slice(0, 300);
    }
    if (typeof payload.message === "string") message = payload.message.slice(0, 300);
  } catch {
    if (responseBody.trim()) message = responseBody.trim().slice(0, 300);
  }
  return { message, code, param };
}

async function invokeProfileApi(payload: unknown, env: Env): Promise<Response> {
  const base = env.SUPABASE_FUNCTIONS_URL?.trim().replace(/\/$/, "");
  const secret = env.NEXTGEN_PROXY_SECRET?.trim();
  if (!base || !secret) throw new Error("Profile backend is not configured");
  return fetch(`${base}/voice-profile-api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-nextgen-proxy-secret": secret },
    body: JSON.stringify(payload)
  });
}

async function readJson<T>(request: Request): Promise<T | null> {
  const length = Number(request.headers.get("Content-Length") || "0");
  if (length > 100_000) return null;
  try { return await request.json() as T; } catch { return null; }
}

function isAllowedOrigin(request: Request, env: Env, url: URL): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (origin === url.origin || allowed.includes(origin)) return true;
  if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return true;
  return false;
}

function voiceCorsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin") || env.ALLOWED_ORIGIN || "null";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin"
  };
}

function voiceJson(
  request: Request,
  env: Env,
  value: unknown,
  status = 200,
  extraHeaders: HeadersInit = {}
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...voiceCorsHeaders(request, env),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

async function safetyIdentifier(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return `nga_${Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([left, right].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
  ));
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

async function createAdminCookie(request: Request, secret: string): Promise<string> {
  const payload = toBase64Url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ADMIN_TTL_SECONDS }));
  const signature = await sign(payload, secret);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${payload}.${signature}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${ADMIN_TTL_SECONDS}`;
}

function expiredAdminCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`;
}

async function hasValidAdminSession(request: Request, env: Env): Promise<boolean> {
  const secret = env.VOICE_ADMIN_SESSION_SECRET?.trim();
  if (!secret) return false;
  const raw = readCookie(request.headers.get("Cookie") || "", ADMIN_COOKIE);
  if (!raw) return false;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !(await secureEqual(signature, await sign(payload, secret)))) return false;
  try {
    const data = JSON.parse(fromBase64Url(payload)) as { exp?: number };
    return typeof data.exp === "number" && data.exp > Date.now() / 1000;
  } catch { return false; }
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
}

function toBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function readCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

async function rateCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open("nextgen-voice-admin-rate");
  } catch {
    return null;
  }
}

function rateKey(ipHash: string): Request {
  return new Request(`https://voice-admin-rate.invalid/${encodeURIComponent(ipHash)}`);
}

async function isLoginRateLimited(ipHash: string): Promise<boolean> {
  try {
    const cache = await rateCache();
    if (!cache) return false;
    const cached = await cache.match(rateKey(ipHash));
    if (!cached) return false;
    const value = await cached.json() as { failures?: number };
    return (value.failures || 0) >= 5;
  } catch {
    return false;
  }
}

async function recordLoginFailure(ipHash: string): Promise<void> {
  try {
    const cache = await rateCache();
    if (!cache) return;
    const key = rateKey(ipHash);
    const previous = await cache.match(key);
    const data = previous ? await previous.json() as { failures?: number } : {};
    await cache.put(key, new Response(JSON.stringify({ failures: (data.failures || 0) + 1 }), {
      headers: { "Cache-Control": "max-age=900", "Content-Type": "application/json" }
    }));
  } catch {
    // Login must remain available if the optional edge cache is unavailable.
  }
}

async function clearLoginFailures(ipHash: string): Promise<void> {
  try {
    const cache = await rateCache();
    if (cache) await cache.delete(rateKey(ipHash));
  } catch {
    // Best-effort cleanup only.
  }
}
