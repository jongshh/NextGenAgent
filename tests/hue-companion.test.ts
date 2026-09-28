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
  assert.equal(valid.playbackMode, "timed");
  assert.equal(validatePlayRequest({
    agentId: "pathfinder",
    responseId: "resp-voice",
    playbackMode: "voice",
    cue: { preset: "calm-ground", durationMs: 3000, intensity: "low" }
  })?.playbackMode, "voice");
  assert.equal(validatePlayRequest({
    agentId: "pathfinder",
    responseId: "resp-invalid-mode",
    playbackMode: "forever",
    cue: { preset: "calm-ground", durationMs: 3000, intensity: "low" }
  }), null);
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

test("a voice effect remains active until playback stop restores the light", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const original = { on: { on: true }, dimming: { brightness: 18 }, color_temperature: { mirek: 310 } };
  const client = {
    async getLight() { return original; },
    async setLight(_resourceId: string, body: Record<string, unknown>) { calls.push(body); }
  };
  const controller = new HueEffectController(client, { thinker: "light-2" });
  const request = validatePlayRequest({
    agentId: "thinker",
    responseId: "resp-voice-hold",
    playbackMode: "voice",
    cue: { preset: "calm-ground", durationMs: 3000, intensity: "low" }
  });
  assert.ok(request);

  await controller.play(request);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.notDeepEqual(calls.at(-1), {
    on: { on: true },
    dynamics: { duration: 700 },
    dimming: { brightness: 18 },
    color_temperature: { mirek: 310 }
  });

  await controller.stop();
  assert.deepEqual(calls.at(-1), {
    on: { on: true },
    dynamics: { duration: 700 },
    dimming: { brightness: 18 },
    color_temperature: { mirek: 310 }
  });
});

test("stopping an older response does not cancel a newer light effect", async () => {
  const original = { on: { on: false }, dimming: { brightness: 20 } };
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    async getLight() { return original; },
    async setLight(_resourceId: string, body: Record<string, unknown>) { calls.push(body); }
  };
  const controller = new HueEffectController(client, { creator: "light-3" });
  const request = validatePlayRequest({
    agentId: "creator",
    responseId: "new-response",
    playbackMode: "voice",
    cue: { preset: "hopeful-guide", durationMs: 3000, intensity: "gentle" }
  });
  assert.ok(request);

  await controller.play(request);
  await controller.stop("old-response");
  assert.notDeepEqual(calls.at(-1), {
    on: { on: false },
    dynamics: { duration: 700 },
    dimming: { brightness: 20 }
  });

  await controller.stop("new-response");
  assert.deepEqual(calls.at(-1), {
    on: { on: false },
    dynamics: { duration: 700 },
    dimming: { brightness: 20 }
  });
});
