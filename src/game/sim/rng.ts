import type { RngChannels, RngChannel, Seed } from "./types";

const NON_ZERO_FALLBACK = 0x6d2b79f5;

/** Stable FNV-1a seed normalization for numeric or textual run seeds. */
export function hashSeed(seed: Seed): number {
  const text = typeof seed === "number" ? String(seed) : seed;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const normalized = hash >>> 0;
  return normalized === 0 ? NON_ZERO_FALLBACK : normalized;
}

function mixSeed(seed: number, salt: number): number {
  let value = (seed ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) || NON_ZERO_FALLBACK;
}

export function createRngChannels(seed: Seed): RngChannels {
  const base = hashSeed(seed);
  return {
    weather: mixSeed(base, 0x77656174),
    conditions: mixSeed(base, 0x636f6e64),
    loot: mixSeed(base, 0x6c6f6f74),
  };
}

/** Mulberry32 step. It returns the value and the next serializable state. */
export function nextRandom(state: number): [value: number, nextState: number] {
  const nextState = (state + NON_ZERO_FALLBACK) >>> 0;
  let value = nextState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  const result = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  return [result, nextState];
}

export function drawRandom(
  channels: RngChannels,
  channel: RngChannel,
): number {
  const [value, nextState] = nextRandom(channels[channel]);
  channels[channel] = nextState;
  return value;
}

