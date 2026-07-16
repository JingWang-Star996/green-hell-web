# CANOPY: First Night — Project Brief

Last updated: 2026-07-16

This file is the current delivery contract. Keep it short and revise it when the milestone changes.

## Current phase

- Mode: vertical-slice
- Engine or stack: Web / Three.js + React + deterministic TypeScript simulation
- Target platform: desktop and mobile browsers, packaged for Bilibili Toy; each platform may use a different information hierarchy but must expose the same game verbs.
- Input method: keyboard/mouse first-person controls and a first-class touch path with complete panel/equipment access.
- Timebox or deadline: 日更维护；当前为“前哨迁营 v1 + 开始页发布账本”纵切。
- Runnable entry point: `npm run dev`, then the local root route.

## Player experience hypothesis

- Player role: a field survivor reading and shaping a living rainforest rather than following a static checklist.
- Core promise: every survival action has a readable target, a visible consequence, and a persistent place in the exploration-crafting-building loop.
- Target feeling: deliberate, embodied, resourceful, and able to trust the world and save system.
- Hypothesis: If every discrete object is generated once as a semantic entity, visual similarity guarantees the same base verb, and actions resolve through embodied feedback, players will read the rainforest and form plans instead of memorizing hidden exceptions.

For maintenance work, replace this with the expected behavior, reproduction conditions, and game-feel invariants.

## Core loop

1. Read a biome, identify a real resource, animal, threat, or shelter opportunity, and equip an appropriate tool.
2. Harvest, hunt, craft, build, maintain, or avoid through world actions rather than hidden proximity checks.
3. Observe held-tool motion, impact, target-state change, yield, sound, local UI feedback, and persistent consequence.
4. Use camp improvements and route infrastructure to answer weather, darkness, ecology, storage, injury, and travel pressure.

## Current milestone

- Outcome: make daily updates player-readable, close the first reversible-building gap, and preserve the current living-rainforest/save/mobile foundations.
- Smallest playable change: the title screen owns an append-only release ledger and official player-Wiki link; a player can inspect, confirm and dismantle an empty smoking rack or rain collector, receive a version-stable partial refund, and recover from the immediately written milestone save.
- Must have: desktop R and touch context actions; explicit partial-refund confirmation; no silent loss of rack contents or collected rainwater; exact-ID atomic settlement; busy-rack, non-empty collector, distance, capacity and death rejection; structure disappearance in render/collision on the next projection; local-first milestone autosave; Wiki documentation; desktop/mobile browser smoke; clean Toy package.
- Nice to have: additional Director telemetry, richer ecology behaviors, biome-specific material variants, and broader visual composition polish that does not alter the current world identity.
- Explicit non-goals for this release candidate: dismantling fires, beds, shelters, torch waymarks or the story beacon; upgrades, storage, rope/high-platform networks; claiming the full Left 4 Dead-style resource/threat Director; A3–A5 or a human-verified three-hour chapter; the final Valheim-inspired terrain/material/lighting/composition pass; the complete ecology chain; multiplayer; engine migration; or copying reference-game assets, maps, text, balance, story or distinctive expression.

## Riskiest assumption

- Assumption: streamed visuals can be made a projection of deterministic semantic entities without making saves grow with every visited pristine chunk.
- Cheapest test: generate one chunk from a single semantic object plan, render all discrete trees/rocks from it, alter two nodes, reload, and persist only those two deltas.
- Evidence that supports it: stable IDs, deterministic regeneration, bounded active chunks, valid hit resolution, and a long-distance save staying within the cloud-key budget.
- Evidence that rejects it: the renderer must keep an independent same-looking decoration layer, active entities cannot round-trip through streaming, or unchanged generated objects must be serialized.

## Acceptance evidence

- Build command: `npm run build:toy`
- Test command: `npm run typecheck`, `npm test`, and `npm run lint`
- Run or launch command: `npm run dev`
- Observable success condition: no sampled discrete tree/rock/resource-plant model violates the same-shape/same-base-verb rule; attacks and harvests resolve through physical hit windows; changed objects and animal deaths survive reload.
- Expected artifacts such as build, logs, screenshots, video, or profile: automated architecture/simulation tests, object-audit matrix, exact playtest notes, screenshots/video of focus–action–world-result sequences, and a performance/object-count profile.

## Stop and redirect conditions

- Stop this approach when: deterministic identity, active-bubble embodiment, and differential persistence cannot be reconciled without a versioned save migration.
- Reduce scope when: a new species/building adds content but does not create a readable interaction and at least one systemic relationship.
- Revisit the architecture when: a second same-looking visual-only object generator is introduced, or renderer-side animation becomes authoritative gameplay state.

## Autonomy boundaries

Codex may proceed without asking on reversible repository-local implementation choices, tests, diagnostics, placeholders, and bounded refactors that preserve this brief.

Codex must ask before engine or platform changes, paid services or licensed assets, destructive migrations, credential use beyond already authenticated project tooling, major scope growth, or a subjective direction fork with no agreed winner. For this specific release, the user has explicitly pre-authorized updating the existing GitHub repository, generating and independently checking a Toy preview, submitting the verified candidate to Toy review, and sending the final Feishu notice without another confirmation prompt.

## Known constraints and open questions

- Constraint: Toy package must remain below 140 MB and work from its nested, location-independent hosting path.
- Constraint: original code-native assets are preferred; no protected assets from reference games may be used.
- Constraint: save-file import is untrusted input and must be bounded, validated, reversible and re-wrapped before local/Toy cloud replacement.
- Decision: legacy save compatibility is not required during this research phase; any world-generator identity change still requires an explicit version/namespace bump so stale data fails closed.
- Constraint: gameplay upgrade precedes the Valheim-informed programmatic visual pass; visual research may run in parallel but cannot hide an untrustworthy interaction model.
- Open question: final long-form balance and content cadence require repeated human playtests after the micro, camp, and exploration loops each pass their gate.
- Detailed execution contract: `docs/LIVING_RAINFOREST_GAMEPLAY_SPEC.md`.
- Density, plant and vertical-route contract: `docs/RAINFOREST_DENSITY_PLANT_VERTICALITY_PLAN.md`.
- Player state, death and checkpoint contract: `docs/PLAYER_STATE_DEATH_CHECKPOINT_SPEC.md`.
- Three-hour chapter and narrative contract: `docs/THREE_HOUR_CAMPAIGN_PLAN.md`.
- Programmatic visual research: `docs/VALHEIM_VISUAL_WORLD_STUDY.md`.
- Post-gameplay visual execution gate: `docs/VISUAL_MILESTONE_PERFORMANCE_PROTOCOL.md`.
