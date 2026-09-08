import assert from "node:assert/strict";
import test from "node:test";
import { HueEffectController, validatePlayRequest } from "../apps/hue-companion/src/effects.mjs";

test("Hue play requests accept only allowlisted presets and bounded durations", () => {
  const valid = validatePlayRequest({
    agentId: "pathfinder",
    responseId: "resp-1",
    cue: { preset: "sad-encourage", durationMs: 3000, intensity: "gentle" }
  });
  assert.ok(valid);
  assert.equal(valid.emotion, "sad");
  assert.equal(validatePlayRequest({
    agentId: "pathfinder",
    responseId: "resp-2",
    cue: { preset: "red-strobe", durationMs: 100, intensity: "extreme" }
  }), null);
});

test("a cancelled effect restores the exact prior light state", async () => {
  const calls: Array<{ resourceId: string; body: Record<string, unknown> }> = [];
  const original = {
    on: { on: false },
    dimming: { brightness: 27 },
    color: { xy: { x: 0.21, y: 0.32 } }
  };
  const client = {
    async getLight() { return original; },
    async setLight(resourceId: string, body: Record<string, unknown>) { calls.push({ resourceId, body }); }
  };
  const controller = new HueEffectController(client, { pathfinder: "light-1" });
  const request = validatePlayRequest({
    agentId: "pathfinder",
    responseId: "resp-restore",
    cue: { preset: "happy-celebrate", durationMs: 3000, intensity: "gentle" }
  });
  assert.ok(request);

  await controller.play(request);
  await controller.stop();

  assert.ok(calls.length >= 2);
  assert.deepEqual(calls.at(-1), {
    resourceId: "light-1",
    body: {
      on: { on: false },
      dynamics: { duration: 700 },
      dimming: { brightness: 27 },
      color: { xy: { x: 0.21, y: 0.32 } }
    }
  });
});
