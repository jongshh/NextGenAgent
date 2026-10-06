const BASE_COLORS = { pathfinder: '#ffba66', creator: '#f28cb8', thinker: '#899cff', connector: '#70d4bc' };
export const EMOTION_PALETTES = {
  sad: ['#749fe6', '#91b4ee', '#828dd6'], anxious: ['#efaa65', '#edc088', '#dc995f'],
  confused: ['#a28ade', '#b9a2e9', '#8d96d9'], calm: ['#e7c799', '#efd8b4', '#d9be96'],
  hopeful: ['#7dcbb0', '#a0dab6', '#7cc9c4'], happy: ['#ffc278', '#ffd59b', '#f3ad80'],
  neutral: ['#b9c9df', '#cdd5e2', '#a9c2d4']
};
export function defaultLightProfile(agentId) {
  return { baseColor: BASE_COLORS[agentId], minBrightness: 12, maxBrightness: 100, sensitivity: 1,
    flicker: 0.7, cycleSeconds: 9, emotionBlend: 0.65, palettes: structuredClone(EMOTION_PALETTES) };
}
export function lightProfiles(value = {}) {
  return Object.fromEntries(Object.keys(BASE_COLORS).map(id => [id, value[id] || defaultLightProfile(id)]));
}
export function validateLightProfile(value) {
  const hex = color => typeof color === 'string' && /^#[a-fA-F0-9]{6}$/.test(color);
  if (!value || !hex(value.baseColor) || !['minBrightness', 'maxBrightness', 'sensitivity', 'flicker', 'cycleSeconds', 'emotionBlend'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key])) ||
      value.minBrightness < 1 || value.maxBrightness > 100 || value.minBrightness > value.maxBrightness ||
      value.sensitivity < 0 || value.sensitivity > 2 || value.flicker < 0 || value.flicker > 1 ||
      value.cycleSeconds < 3 || value.cycleSeconds > 30 || value.emotionBlend < 0 || value.emotionBlend > 1 ||
      !value.palettes || Object.keys(EMOTION_PALETTES).some(emotion => !Array.isArray(value.palettes[emotion]) || value.palettes[emotion].length !== 3 || !value.palettes[emotion].every(hex))) {
    throw new Error('조명 프로필의 색상, 밝기 범위 또는 반응 설정이 올바르지 않습니다.');
  }
  return { baseColor: value.baseColor, minBrightness: value.minBrightness, maxBrightness: value.maxBrightness,
    sensitivity: value.sensitivity, flicker: value.flicker, cycleSeconds: value.cycleSeconds, emotionBlend: value.emotionBlend,
    palettes: Object.fromEntries(Object.keys(EMOTION_PALETTES).map(emotion => [emotion, [...value.palettes[emotion]]])) };
}
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); }
export function profileColor(profile, emotion, elapsedMs, phase = 'answer') {
  const palette = profile.palettes[emotion] || profile.palettes.neutral;
  const position = ((elapsedMs / (profile.cycleSeconds * 1000)) % 1 + 1) % 1 * palette.length;
  const index = Math.floor(position);
  const t = (1 - Math.cos((position - index) * Math.PI)) / 2;
  const a = rgb(palette[index]), b = rgb(palette[(index + 1) % palette.length]), base = rgb(profile.baseColor);
  const blend = phase === 'listening' ? 0 : profile.emotionBlend;
  const linear = base.map((v, i) => {
    const c = v * (1 - blend) + (a[i] * (1 - t) + b[i] * t) * blend;
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  });
  const [r, g, blue] = linear;
  const x = r * .664511 + g * .154324 + blue * .162028;
  const y = r * .283881 + g * .668433 + blue * .047685;
  const z = r * .000088 + g * .07231 + blue * .986039;
  return { xy: x + y + z ? { x: x / (x + y + z), y: y / (x + y + z) } : { x: .3127, y: .329 } };
}
export function profileBrightness(profile, level, timeMs) {
  const amplitude = Math.sqrt(Math.min(1, Math.max(0, level * profile.sensitivity)));
  const range = profile.maxBrightness - profile.minBrightness;
  const flicker = (Math.sin(timeMs / 117) + .75 * Math.sin(timeMs / 71)) * range * .05 * profile.flicker;
  return Math.max(profile.minBrightness, Math.min(profile.maxBrightness, Math.round(profile.minBrightness + range * amplitude + flicker)));
}
