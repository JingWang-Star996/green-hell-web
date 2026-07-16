import {
  campfireStateForStructure,
  nearestLitCampfire,
  placedStructuresOfKind,
} from "../sim/campStructures";
import { MAXIMUM_FIRE_FUEL_SECONDS } from "../sim/time";
import type { GameState } from "../sim/types";
import {
  resolveCampfireFeedback,
  type CampfireFeedbackTargets,
} from "./campfireFeedback";

export interface CampfireFeedbackCursorState {
  initialized: boolean;
  globalEventId: number;
  byStructureId: ReadonlyMap<string, number>;
}

export interface CampfireFeedbackFrame {
  feedbackByStructureId: ReadonlyMap<string, CampfireFeedbackTargets>;
  audibleStructureId: string | null;
  cursor: CampfireFeedbackCursorState;
}

export const CAMPFIRE_AUDIO_INNER_RADIUS = 2.5;
export const CAMPFIRE_AUDIO_OUTER_RADIUS = 18;

function campfireAudioAttenuation(distance: number): number {
  if (!Number.isFinite(distance) || distance >= CAMPFIRE_AUDIO_OUTER_RADIUS) {
    return 0;
  }
  if (distance <= CAMPFIRE_AUDIO_INNER_RADIUS) return 1;
  const normalized =
    (distance - CAMPFIRE_AUDIO_INNER_RADIUS) /
    (CAMPFIRE_AUDIO_OUTER_RADIUS - CAMPFIRE_AUDIO_INNER_RADIUS);
  const remaining = Math.max(0, 1 - normalized);
  return remaining * remaining;
}

export function createCampfireFeedbackCursor(): CampfireFeedbackCursorState {
  return {
    initialized: false,
    globalEventId: 0,
    byStructureId: new Map(),
  };
}

/**
 * Routes authoritative fire events to their exact placed structure. A newly
 * built fire starts from the previous global cursor, while hydrated fires
 * suppress historical transients on the first frame.
 */
export function resolveCampfireFeedbackFrame(
  state: GameState,
  previous: CampfireFeedbackCursorState,
  reducedMotion: boolean,
): CampfireFeedbackFrame {
  const campfires = placedStructuresOfKind(state, "campfire");
  const primaryId = campfires[0]?.id ?? null;
  const previousGlobalEventId = previous.globalEventId;
  const globalEventId = state.eventLog.reduce(
    (maximum, event) =>
      Number.isSafeInteger(event.id) && event.id > 0
        ? Math.max(maximum, event.id)
        : maximum,
    previousGlobalEventId,
  );
  const feedbackByStructureId = new Map<string, CampfireFeedbackTargets>();
  const byStructureId = new Map<string, number>();

  for (const structure of campfires) {
    const fire = campfireStateForStructure(state, structure);
    const distance = Math.hypot(
      structure.position.x - state.player.position.x,
      structure.position.z - state.player.position.z,
    );
    const audioAttenuation = campfireAudioAttenuation(distance);
    const events = state.eventLog.filter((event) => {
      const structureId = event.details?.structureId;
      return structureId === structure.id ||
        (structure.id === primaryId && typeof structureId !== "string");
    });
    const lastProcessedEventId = previous.byStructureId.has(structure.id)
      ? previous.byStructureId.get(structure.id)!
      : previous.initialized
        ? previousGlobalEventId
        : null;
    const resolvedFeedback = resolveCampfireFeedback({
      built: true,
      lit: fire.lit,
      fuelSeconds: fire.fuelSeconds,
      fuelCapacitySeconds: MAXIMUM_FIRE_FUEL_SECONDS,
      reducedMotion,
      authoritativeEvents: events,
      lastProcessedEventId,
    });
    const feedback: CampfireFeedbackTargets = {
      ...resolvedFeedback,
      audio: {
        ...resolvedFeedback.audio,
        loopGain: resolvedFeedback.audio.loopGain * audioAttenuation,
      },
      // Visual smoke/sparks may still be visible at range. Only their sound is
      // attenuated; a zero-gain descriptor is consumed silently by AudioEngine.
      transients: resolvedFeedback.transients.map((transient) => ({
        ...transient,
        audioGain: transient.audioGain * audioAttenuation,
      })),
    };
    feedbackByStructureId.set(structure.id, feedback);
    byStructureId.set(structure.id, feedback.lastProcessedEventId);
  }

  return {
    feedbackByStructureId,
    audibleStructureId:
      nearestLitCampfire(
        state,
        state.player.position,
        CAMPFIRE_AUDIO_OUTER_RADIUS,
      )?.id ?? null,
    cursor: {
      initialized: true,
      globalEventId,
      byStructureId,
    },
  };
}
