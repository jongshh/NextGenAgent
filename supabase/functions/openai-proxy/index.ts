const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedProxy(request)) return json({ error: "unauthorized" }, 401);

  const body = await request.json().catch(() => null) as {
    operation?: "moderations" | "vector_search" | "responses";
    payload?: Record<string, unknown>;
  } | null;
  if (!body?.operation || !body.payload) return json({ error: "invalid_request" }, 400);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "openai_not_configured" }, 500);

  let endpoint: string;
  if (body.operation === "moderations") {
    endpoint = "https://api.openai.com/v1/moderations";
  } else if (body.operation === "responses") {
    endpoint = "https://api.openai.com/v1/responses";
  } else if (body.operation === "vector_search") {
    const vectorStoreId = Deno.env.get("OPENAI_VECTOR_STORE_ID");
    if (!vectorStoreId) return json({ error: "vector_store_not_configured" }, 500);
    endpoint = `https://api.openai.com/v1/vector_stores/${encodeURIComponent(vectorStoreId)}/search`;
  } else {
    return json({ error: "operation_not_allowed" }, 400);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body.payload)
  });
  const responseBody = await response.text();
  return new Response(responseBody, {
    status: response.status,
    headers: JSON_HEADERS
  });
});

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

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
