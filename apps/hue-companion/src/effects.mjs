const EMOTION_COLORS = {
  sad: { color: { xy: { x: 0.17, y: 0.16 } } },
  anxious: { color: { xy: { x: 0.56, y: 0.4 } } },
  confused: { color: { xy: { x: 0.38, y: 0.18 } } },
  calm: { color_temperature: { mirek: 370 } },
  hopeful: { color: { xy: { x: 0.3, y: 0.55 } } },
  happy: { color: { xy: { x: 0.48, y: 0.45 } } },
  neutral: { color_temperature: { mirek: 300 } }
};

const PATTERN_FACTORS = {
  empathize: [0.35, 0.72],
  encourage: [0.42, 0.82, 0.46, 0.9],
  celebrate: [0.48, 0.9, 0.52, 0.95, 0.56, 1],
  reflect: [0.42, 0.68, 0.44, 0.72],
  guide: [0.45, 0.82],
  ground: [0.38]
};

const BASE_BRIGHTNESS = { low: 35, gentle: 62, standard: 78 };
const PLAYBACK_MODES = new Set(["timed", "voice"]);
const AGENT_IDS = new Set(["pathfinder", "creator", "thinker", "connector"]);
const EMOTIONS = new Set(Object.keys(EMOTION_COLORS));
const INTENTS = new Set(Object.keys(PATTERN_FACTORS));

export function validatePlayRequest(value) {
  if (!value || typeof value !== "object" || !AGENT_IDS.has(value.agentId) ||
      typeof value.responseId !== "string" || value.responseId.length < 1 || value.responseId.length > 160 ||
      !value.cue || typeof value.cue !== "object") return null;

  const match = /^([a-z]+)-([a-z]+)$/.exec(value.cue.preset || "");
  const durationMs = Number(value.cue.durationMs);
  const playbackMode = value.playbackMode || "timed";
  if (!match || !EMOTIONS.has(match[1]) || !INTENTS.has(match[2]) ||
      !["low", "gentle", "standard"].includes(value.cue.intensity) ||
      !PLAYBACK_MODES.has(playbackMode) ||
      !Number.isInteger(durationMs) || durationMs < 3000 || durationMs > 8000) return null;

  return {
    agentId: value.agentId,
    responseId: value.responseId,
    cue: { preset: value.cue.preset, durationMs, intensity: value.cue.intensity },
    playbackMode,
    emotion: match[1],
    intent: match[2]
  };
}

export class HueEffectController {
  constructor(client, targets) {
    this.client = client;
    this.targets = targets;
    this.current = null;
    this.baselines = new Map();
    this.lastError = null;
  }

  async status() {
    await Promise.all([...new Set(Object.values(this.targets))].map((resourceId) => this.client.getLight(resourceId)));
    return true;
  }

  async play(request) {
    await this.stop(undefined, false);
    const resourceId = this.targets[request.agentId];
    if (!resourceId) throw new Error("선배에 매핑된 Hue 전구가 없습니다.");
    const original = await this.client.getLight(resourceId);
    if (!this.baselines.has(resourceId)) this.baselines.set(resourceId, original);
    const controller = new AbortController();
    const effect = {
      resourceId,
      agentId: request.agentId,
      preset: request.cue.preset,
      responseId: request.responseId,
      original,
      controller,
      restoreOnStop: request.playbackMode === "timed",
      promise: null
    };
    this.current = effect;
    effect.promise = this.run(effect, request)
      .catch((error) => {
        this.lastError = { message: error.message, at: new Date().toISOString() };
        console.error(JSON.stringify({
          message: "Hue 효과 실행 실패",
          responseId: effect.responseId,
          resourceId: effect.resourceId,
          error: error instanceof Error ? error.message : String(error)
        }));
      })
      .finally(() => {
        if (this.current === effect) this.current = null;
      });
  }

  async stop(responseId, restore = true) {
    if (!this.current) return;
    if (responseId && this.current.responseId !== responseId) return;
    const active = this.current;
    active.restoreOnStop = restore;
    active.controller.abort();
    await active.promise;
  }

  async reset() {
    await this.stop(undefined, false);
    const baselines = [...this.baselines.entries()];
    await Promise.all(baselines.map(async ([resourceId, light]) => {
      try {
        await this.restore(resourceId, light);
        this.baselines.delete(resourceId);
      } catch (error) {
        this.lastError = { message: error.message, at: new Date().toISOString() };
        console.error(JSON.stringify({
          message: "Hue 기준 상태 복원 실패",
          resourceId,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    }));
  }

  async manual(resourceId, state) {
    if (this.current?.resourceId === resourceId) await this.stop(undefined, false);
    if (!this.baselines.has(resourceId)) this.baselines.set(resourceId, await this.client.getLight(resourceId));
    await this.client.setLight(resourceId, state);
  }

  async restoreLight(resourceId) {
    if (this.current?.resourceId === resourceId) await this.stop(undefined, false);
    const baseline = this.baselines.get(resourceId);
    if (baseline) {
      await this.restore(resourceId, baseline);
      this.baselines.delete(resourceId);
    }
  }

  async run(effect, request) {
    const [, intent] = request.cue.preset.split("-");
    const [emotion] = request.cue.preset.split("-");
    const factors = PATTERN_FACTORS[intent];
    const baseBrightness = BASE_BRIGHTNESS[request.cue.intensity];
    const stageMs = Math.max(500, Math.floor(request.cue.durationMs / factors.length));

    try {
      for (const factor of factors) {
        if (effect.controller.signal.aborted) break;
        const transitionMs = intent === "ground" ? Math.min(700, request.cue.durationMs) : stageMs;
        await this.client.setLight(effect.resourceId, {
          on: { on: true },
          dimming: { brightness: Math.max(10, Math.min(100, Math.round(baseBrightness * factor))) },
          ...EMOTION_COLORS[emotion],
          dynamics: { duration: transitionMs }
        });
        await abortableDelay(intent === "ground" ? request.cue.durationMs : stageMs, effect.controller.signal);
      }
      if (request.playbackMode === "voice" && !effect.controller.signal.aborted) {
        await waitForAbort(effect.controller.signal);
      }
    } finally {
      if (effect.restoreOnStop) {
        await this.restore(effect.resourceId, effect.original).catch((error) => {
          console.error(JSON.stringify({ message: "Hue 상태 복원 실패", error: error.message }));
        });
      }
    }
  }

  async restore(resourceId, light) {
    const state = { on: { on: Boolean(light.on?.on) }, dynamics: { duration: 700 } };
    if (typeof light.dimming?.brightness === "number") {
      state.dimming = { brightness: light.dimming.brightness };
    }
    if (typeof light.color?.xy?.x === "number" && typeof light.color?.xy?.y === "number") {
      state.color = { xy: { x: light.color.xy.x, y: light.color.xy.y } };
    } else if (typeof light.color_temperature?.mirek === "number") {
      state.color_temperature = { mirek: light.color_temperature.mirek };
    }
    await this.client.setLight(resourceId, state);
  }
}

function waitForAbort(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", resolve, { once: true });
  });
}

function abortableDelay(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
