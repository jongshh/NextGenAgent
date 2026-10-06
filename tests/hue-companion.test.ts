import assert from "node:assert/strict";
import test from "node:test";
import { candleBrightness, HueEffectController, validatePlayRequest } from "../apps/hue-companion/src/effects.mjs";

test('voice brightness follows the latest volume, ignores stale samples, and stops on manual control', async () => {
  const calls: any[] = [];
  const controller = new HueEffectController({
    async getLight() { return { on: { on: false }, dimming: { brightness: 40 } }; },
    async setLight(_id: string, state: any) { calls.push(state); }
  }, { pathfinder: 'light-1' });
  const request = validatePlayRequest({ agentId: 'pathfinder', responseId: 'audio-test', playbackMode: 'voice',
    cue: { preset: 'calm-guide', durationMs: 3000, intensity: 'gentle' } });
  await controller.play(request);
  try {
    assert.equal(controller.audioLevel('creator', 1), false);
    assert.equal(controller.audioLevel('pathfinder', NaN), false);
    assert.equal(controller.audioLevel('pathfinder', 2), false);
    assert.equal(controller.audioLevel('pathfinder', 1), true);
    await new Promise(resolve => setTimeout(resolve, 230));
    assert.ok(calls.at(-1).dimming.brightness >= 93);
    controller.current.levelAt = Date.now() - 1000;
    await new Promise(resolve => setTimeout(resolve, 230));
    assert.ok(calls.at(-1).dimming.brightness <= 25);
    await controller.manual('light-1', { dimming: { brightness: 44 } });
    assert.equal(controller.audioLevel('pathfinder', 1), false);
    const count = calls.length;
    await new Promise(resolve => setTimeout(resolve, 230));
    assert.equal(calls.length, count);
    await controller.reset();
    assert.equal(calls.at(-1).dimming.brightness, 40);
  } finally { await controller.reset(); }
});

test('candle brightness has a dramatic bounded range', () => {
  for (let time = 0; time < 3000; time += 50) {
    assert.ok(candleBrightness(0, time) >= 10 && candleBrightness(0, time) <= 25);
    assert.ok(candleBrightness(1, time) >= 93 && candleBrightness(1, time) <= 100);
  }
});

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

test("a completed voice answer holds its color until the session is reset", async () => {
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

  await controller.stop(undefined, false);
  assert.notDeepEqual(calls.at(-1), {
    on: { on: true },
    dynamics: { duration: 700 },
    dimming: { brightness: 18 },
    color_temperature: { mirek: 310 }
  });

  await controller.reset();
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

test("a bulb communication failure does not reject or wedge the controller", async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  let attempts = 0;
  const client = {
    async getLight() { return { on: { on: true }, dimming: { brightness: 40 } }; },
    async setLight() {
      attempts += 1;
      if (attempts === 1) throw new Error("communication_error");
    }
  };
  const controller = new HueEffectController(client, { connector: "light-4" });
  const failed = validatePlayRequest({
    agentId: "connector",
    responseId: "failed-effect",
    playbackMode: "voice",
    cue: { preset: "calm-empathize", durationMs: 3000, intensity: "low" }
  });
  assert.ok(failed);
  try {
    await controller.play(failed);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const next = validatePlayRequest({
      agentId: "connector",
      responseId: "next-effect",
      playbackMode: "voice",
      cue: { preset: "confused-reflect", durationMs: 3000, intensity: "gentle" }
    });
    assert.ok(next);
    await controller.play(next);
    await controller.stop(undefined, false);
    assert.ok(attempts >= 2);
  } finally {
    console.error = originalConsoleError;
  }
});
