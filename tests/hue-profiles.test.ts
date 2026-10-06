import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLightProfile, lightProfiles, profileBrightness, profileColor, validateLightProfile } from '../apps/hue-companion/src/profiles.mjs';

test('legacy lighting configs receive distinct independent mentor profiles', () => {
  const profiles = lightProfiles();
  assert.equal(new Set(Object.values(profiles).map((p: any) => p.baseColor)).size, 4);
  profiles.creator.palettes.happy[0] = '#ffffff';
  assert.notEqual(profiles.thinker.palettes.happy[0], '#ffffff');
});
test('profile validation rejects invalid ranges, NaN, and incomplete palettes', () => {
  const profile = defaultLightProfile('pathfinder');
  assert.throws(() => validateLightProfile({ ...profile, minBrightness: 90, maxBrightness: 50 }));
  assert.throws(() => validateLightProfile({ ...profile, sensitivity: NaN }));
  assert.throws(() => validateLightProfile({ ...profile, cycleSeconds: 0 }));
  assert.throws(() => validateLightProfile({ ...profile, palettes: { happy: ['red'] } }));
  assert.deepEqual(validateLightProfile(profile), profile);
});
test('colors interpolate continuously through all palette entries and loop seamlessly', () => {
  const profile = { ...defaultLightProfile('creator'), emotionBlend: 1, cycleSeconds: 6 };
  const start = profileColor(profile, 'happy', 0);
  assert.notDeepEqual(profileColor(profile, 'happy', 1000), start);
  assert.deepEqual(profileColor(profile, 'happy', 6000), start);
  const near = profileColor(profile, 'happy', 5999);
  assert.ok(Math.abs(near.xy.x - start.xy.x) < .00001);
  assert.ok(Math.abs(near.xy.y - start.xy.y) < .00001);
  assert.deepEqual(profileColor(profile, 'happy', 0, 'listening'), profileColor(profile, 'sad', 3000, 'listening'));
});
test('brightness obeys mentor limits and configured reaction strength', () => {
  const profile = { ...defaultLightProfile('thinker'), minBrightness: 30, maxBrightness: 60, flicker: 0 };
  assert.equal(profileBrightness(profile, 0, 0), 30);
  assert.equal(profileBrightness(profile, 1, 0), 60);
  assert.equal(profileBrightness({ ...profile, sensitivity: 0 }, 1, 0), 30);
});
