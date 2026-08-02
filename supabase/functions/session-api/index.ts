const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedProxy(request)) return json({ error: "unauthorized" }, 401);

  const body = await request.json().catch(() => null) as {
    action?: string;
    participantId?: string;
    sessionData?: unknown;
  } | null;
  if (!body) return json({ error: "invalid_json" }, 400);

  const participantId = normalizeParticipantId(body.participantId);
  if (!participantId) {
    return json({ error: "invalid_participant_id" }, 400);
  }

  const participantKey = await sha256(participantId);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = getServiceKey();
  if (!supabaseUrl || !serviceKey) return json({ error: "supabase_not_configured" }, 500);

  if (body.action === "load") {
    const query = new URLSearchParams({
      select: "session_data,updated_at",
      participant_key: `eq.${participantKey}`,
      limit: "1"
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/participant_sessions?${query}`, {
      headers: adminHeaders(serviceKey)
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) return json({ error: "session_read_failed" }, 502);
    const record = Array.isArray(rows) ? rows[0] : null;
    return json({
      found: Boolean(record),
      sessionData: record?.session_data || { version: 1, sessions: {} },
      updatedAt: record?.updated_at || null
    });
  }

  if (body.action === "save") {
    if (!isSessionData(body.sessionData)) return json({ error: "invalid_session_data" }, 400);
    const serialized = JSON.stringify(body.sessionData);
    if (serialized.length > 500_000) return json({ error: "session_too_large" }, 413);

    const response = await fetch(
      `${supabaseUrl}/rest/v1/participant_sessions?on_conflict=participant_key`,
      {
        method: "POST",
        headers: {
          ...adminHeaders(serviceKey),
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({
          participant_key: participantKey,
          session_data: body.sessionData,
          updated_at: new Date().toISOString()
        })
      }
    );
    if (!response.ok) return json({ error: "session_write_failed" }, 502);
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});

function normalizeParticipantId(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  return /^[\p{L}\p{N}_-]{4,32}$/u.test(normalized) ? normalized : null;
}

function isSessionData(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && Boolean(candidate.sessions) && typeof candidate.sessions === "object";
}

function isTrustedProxy(request: Request): boolean {
  const expected = Deno.env.get("NEXTGEN_PROXY_SECRET");
  const actual = request.headers.get("x-nextgen-proxy-secret");
  return Boolean(expected && actual && timingSafeEqual(expected, actual));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function getServiceKey(): string | null {
  const current = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (current) {
    try {
      const keys = JSON.parse(current) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Fall through to the legacy service role key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

function adminHeaders(serviceKey: string): Record<string, string> {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json"
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
