import assert from "node:assert/strict";
import test from "node:test";
import worker, { type Env } from "../apps/worker/src/index";
import { PARTICIPANT_ID_PATTERN } from "../apps/web/src/session-id";

const localEnv: Env = {
  ALLOWED_ORIGIN: "http://localhost:5173"
};

test("participant ID pattern is valid under the browser Unicode Sets flag", () => {
  const pattern = new RegExp(`^(?:${PARTICIPANT_ID_PATTERN})$`, "v");
  assert.equal(pattern.test("dream-2026"), true);
  assert.equal(pattern.test("꿈다락_2026"), true);
  assert.equal(pattern.test("bad id"), false);
  assert.equal(pattern.test("abc"), false);
});

test("local Worker accepts localhost and 127.0.0.1 as equivalent origins", async () => {
  const origin = "http://127.0.0.1:5173";
  const response = await worker.fetch(new Request("http://localhost:8787/api/session/load", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  }), localEnv);

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(response.headers.get("Vary"), "Origin");
});

test("session response echoes the allowed local request origin", async () => {
  const origin = "http://127.0.0.1:5173";
  const response = await worker.fetch(new Request("http://localhost:8787/api/session/load", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ participantId: "dream-2026" })
  }), localEnv);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.deepEqual(await response.json(), {
    found: false,
    sessionData: { version: 1, sessions: {} },
    cloud: false
  });
});

test("production Worker rejects origins outside its configured allowlist", async () => {
  const response = await worker.fetch(new Request("https://worker.example.test/api/session/load", {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.example.test" }
  }), {
    ALLOWED_ORIGIN: "https://app.example.test"
  });

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});
