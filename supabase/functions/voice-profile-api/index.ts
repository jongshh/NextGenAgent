const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedProxy(request)) return json({ error: "unauthorized" }, 401);

  const body = await request.json().catch(() => null) as {
    action?: "list" | "save" | "prompts-load" | "prompts-save";
    profile?: Record<string, unknown>;
    configuration?: Record<string, unknown>;
    version?: number;
  } | null;
  if (!body?.action) return json({ error: "invalid_request" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "supabase_not_configured" }, 500);

  if (body.action === 'prompts-load') {
    const response = await fetch(`${supabaseUrl}/rest/v1/mentor_prompt_configuration?id=eq.default&select=configuration,version,updated_at`, { headers: adminHeaders(serviceKey) });
    if (!response.ok) return forward(response);
    const rows = await response.json();
    return json(rows[0] || { configuration: null, version: 0 });
  }
  if (body.action === 'prompts-save') {
    if (!isValidPromptConfiguration(body.configuration) || !Number.isSafeInteger(body.version) || body.version! < 0) return json({ error: 'invalid_prompt_configuration' }, 400);
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/save_mentor_prompt_configuration`, {
      method: 'POST', headers: adminHeaders(serviceKey),
      body: JSON.stringify({ p_configuration: body.configuration, p_expected_version: body.version })
    });
    if (!response.ok) return forward(response);
    const rows = await response.json();
    if (!rows.length) return json({ error: '다른 창에서 프롬프트가 변경됐습니다. 다시 불러온 뒤 저장하세요.' }, 409);
    return json({ ok: true, configuration: rows[0].configuration, version: rows[0].version });
  }
  if (body.action !== 'list' && body.action !== 'save') return json({ error: 'invalid_action' }, 400);

  if (body.action === "list") {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/mentor_voice_profiles?select=*&order=agent_id.asc`,
      { headers: adminHeaders(serviceKey) }
    );
    if (!response.ok) return forward(response);
    const rows = await response.json() as Array<Record<string, unknown>>;
    return json({ profiles: rows.map(toClientProfile) });
  }

  if (!body.profile || !isValidProfile(body.profile)) {
    return json({ error: "invalid_voice_profile" }, 400);
  }
  const profile = body.profile;
  const row = {
    agent_id: profile.agentId,
    provider: "openai-live",
    model: profile.model,
    voice_id: profile.voiceId,
    speaking_instructions: profile.speakingInstructions,
    activation_mode: profile.activationMode,
    eagerness: profile.eagerness,
    preview_text: profile.previewText,
    enabled: profile.enabled,
    version: profile.version,
    updated_at: new Date().toISOString()
  };
  const response = await fetch(
    `${supabaseUrl}/rest/v1/mentor_voice_profiles?on_conflict=agent_id`,
    {
      method: "POST",
      headers: { ...adminHeaders(serviceKey), Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row)
    }
  );
  if (!response.ok) return forward(response);
  const rows = await response.json() as Array<Record<string, unknown>>;
  return json({ ok: true, profile: toClientProfile(rows[0] || row) });
});

function isValidPromptConfiguration(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, any>;
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 12000;
  return ['commonPrompt', 'responsePrompt', 'livePrompt', 'previewPrompt'].every(key => text(row[key])) &&
    ['tap_vad', 'wake_prefix', 'push_to_talk'].every(key => text(row.activation?.[key])) &&
    ['low', 'auto', 'high'].every(key => text(row.patience?.[key])) &&
    ['pathfinder', 'creator', 'thinker', 'connector'].every(key => text(row.agents?.[key]?.personality) && text(row.agents?.[key]?.voiceDirection));
}

function isValidProfile(profile: Record<string, unknown>): boolean {
  const agents = new Set(["pathfinder", "creator", "thinker", "connector"]);
  const voices = new Set(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]);
  const modes = new Set(["tap_vad", "wake_prefix", "push_to_talk"]);
  const eagerness = new Set(["low", "auto", "high"]);
  return typeof profile.agentId === "string" && agents.has(profile.agentId) &&
    typeof profile.voiceId === "string" && voices.has(profile.voiceId) &&
    typeof profile.model === "string" && profile.model.length > 0 && profile.model.length <= 80 &&
    typeof profile.speakingInstructions === "string" && profile.speakingInstructions.length <= 600 &&
    typeof profile.activationMode === "string" && modes.has(profile.activationMode) &&
    typeof profile.eagerness === "string" && eagerness.has(profile.eagerness) &&
    typeof profile.previewText === "string" && profile.previewText.length <= 300 &&
    typeof profile.enabled === "boolean" &&
    typeof profile.version === "number" && Number.isInteger(profile.version) && profile.version > 0;
}

function toClientProfile(row: Record<string, unknown>) {
  return {
    agentId: row.agent_id,
    provider: row.provider,
    model: row.model,
    voiceId: row.voice_id,
    speakingInstructions: row.speaking_instructions,
    activationMode: row.activation_mode,
    eagerness: row.eagerness,
    previewText: row.preview_text,
    enabled: row.enabled,
    version: row.version,
    updatedAt: row.updated_at
  };
}

function isTrustedProxy(request: Request): boolean {
  const expected = Deno.env.get("NEXTGEN_PROXY_SECRET");
  const actual = request.headers.get("x-nextgen-proxy-secret");
  return Boolean(expected && actual && timingSafeEqual(expected, actual));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function adminHeaders(serviceKey: string): Record<string, string> {
  return { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" };
}

async function forward(response: Response): Promise<Response> {
  return new Response(await response.text(), { status: response.status, headers: JSON_HEADERS });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
