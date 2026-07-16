import assert from "node:assert/strict";
import test from "node:test";
import {
  NightLightRig,
  daylightAtMinute,
  inverseSquareLightContribution,
  resolvePersonalLightProfile,
} from "../../src/game/render/NightLightRig";
import {
  createHeldTorchModel,
  updateHeldTorchFlame,
} from "../../src/game/render/HeldTorchModel";
import { HeldItemRig } from "../../src/game/render/HeldItemRig";

test("personal watch light is an automatic short-range readability floor at night", () => {
  const midday = resolvePersonalLightProfile(12 * 60, null);
  assert.equal(midday.source, "off");
  assert.equal(midday.strength, 0);

  const midnight = resolvePersonalLightProfile(0, null);
  assert.equal(midnight.source, "watch");
  assert.ok(midnight.strength > 0.95);
  assert.ok(midnight.beamDistance <= 6.5);
  assert.ok(midnight.pointDistance <= 4);
});

test("torch uses the same deterministic darkness gate but extends the useful range", () => {
  const watch = resolvePersonalLightProfile(23 * 60, null);
  const torch = resolvePersonalLightProfile(23 * 60, "torch");
  assert.equal(torch.source, "torch");
  assert.ok(torch.beamDistance > watch.beamDistance * 2);
  assert.ok(torch.beamIntensity > watch.beamIntensity * 2);
  assert.equal(resolvePersonalLightProfile(12 * 60, "torch").source, "off");

  const stormTorch = resolvePersonalLightProfile(23 * 60, "torch", 1);
  assert.ok(stormTorch.beamIntensity < torch.beamIntensity);
  assert.ok(stormTorch.beamDistance < torch.beamDistance);
  assert.ok(stormTorch.beamDistance > watch.beamDistance);
});

test("torch preserves a bounded useful navigation range in dry and heavy rain", () => {
  const dry = resolvePersonalLightProfile(0, "torch", 0);
  const wet = resolvePersonalLightProfile(0, "torch", 1);
  const contribution = (
    profile: ReturnType<typeof resolvePersonalLightProfile>,
    distance: number,
  ) =>
    inverseSquareLightContribution(
      profile.beamIntensity,
      distance,
      profile.beamDistance,
    );

  assert.ok(contribution(dry, 10) >= 0.45);
  assert.ok(contribution(dry, 15) >= 0.14);
  assert.ok(contribution(wet, 10) >= 0.3);
  assert.ok(contribution(wet, 15) >= 0.08);
  assert.ok(wet.beamIntensity >= dry.beamIntensity * 0.72);
  assert.ok(wet.beamDistance >= dry.beamDistance * 0.92);

  const nearField =
    contribution(dry, 3) +
    inverseSquareLightContribution(
      dry.pointIntensity,
      3,
      dry.pointDistance,
    );
  assert.ok(nearField <= 10, `near-field contribution ${nearField} is too bright`);
});

test("punctual-light contribution and malformed light inputs fail safely", () => {
  assert.equal(inverseSquareLightContribution(64, 24, 24), 0);
  assert.equal(inverseSquareLightContribution(64, 25, 24), 0);
  assert.equal(inverseSquareLightContribution(Number.NaN, 10, 24), 0);
  assert.equal(inverseSquareLightContribution(64, Number.POSITIVE_INFINITY, 24), 0);
  assert.equal(inverseSquareLightContribution(64, 10, Number.NaN), 0);

  for (const minute of [Number.NaN, Number.POSITIVE_INFINITY]) {
    for (const rain of [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      const profile = resolvePersonalLightProfile(minute, "torch", rain);
      for (const value of [
        profile.strength,
        profile.pointIntensity,
        profile.pointDistance,
        profile.beamIntensity,
        profile.beamDistance,
        profile.beamAngle,
        profile.beamPenumbra,
      ]) {
        assert.ok(Number.isFinite(value));
        assert.ok(value >= 0);
      }
    }
  }
});

test("daylight curve stays normalized and wraps negative or overflowing minutes", () => {
  for (const minute of [-1440, -1, 0, 360, 720, 1440, 2881]) {
    const daylight = daylightAtMinute(minute);
    assert.ok(daylight >= 0 && daylight <= 1);
  }
  assert.equal(daylightAtMinute(-1), daylightAtMinute(1439));
  assert.equal(daylightAtMinute(1440), daylightAtMinute(0));
});

test("night rig reflects deterministic source selection without requiring WebGL", () => {
  const rig = new NightLightRig();
  assert.equal(rig.update(720, null, 0, 0, false), "off");
  assert.equal(rig.root.visible, false);
  assert.equal(rig.update(0, null, 0, 0, false), "watch");
  assert.equal(rig.root.visible, true);
  assert.equal(rig.update(0, "torch", 0, 1, true), "torch");
  const point = rig.root.getObjectByName("watch-fill-light") as import("three").PointLight;
  const beam = rig.root.getObjectByName("watch-forward-light") as import("three").SpotLight;
  assert.equal(point.intensity, 18);
  assert.equal(point.distance, 12);
  assert.equal(point.decay, 2);
  assert.equal(point.castShadow, false);
  assert.equal(beam.intensity, 64);
  assert.equal(beam.distance, 24);
  assert.equal(beam.decay, 2);
  assert.equal(beam.penumbra, 0.62);
  assert.equal(beam.castShadow, false);
  assert.equal(
    rig.root.children.filter((child) => "isLight" in child).length,
    2,
  );
});

test("code-native held torch has a readable flame and reduced-motion-safe pulse", () => {
  const model = createHeldTorchModel();
  const flame = model.getObjectByName("held-torch-flame");
  assert.ok(flame);
  updateHeldTorchFlame(flame, 1.2, true);
  assert.equal(flame.scale.y, 1.45);
});

test("first-person equipment connects the torch model to the held-item contract", () => {
  const rig = new HeldItemRig();
  rig.setKind("torch");
  assert.equal(rig.getKind(), "torch");
  assert.ok(rig.root.getObjectByName("held-torch-flame"));
  rig.update(1 / 30, true, false, false);
  rig.dispose();
});
