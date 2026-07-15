# CANOPY: First Night — Playtest Rubric

Use this file to test a question, not to collect vague impressions. Record observations separately from interpretations.

## Build under test

- Date: 2026-07-15
- Version or commit: working branch `agent/living-forest-foundation`, post-`e2496eb` milestone work.
- Platform and device: desktop Chromium at 1920×1080 and 1366×768; touch at 390×844, 844×390 and 667×375; current development build remains local/preview-only while the frozen earlier build is under Toy review.
- Tester profile: one returning survival-game player who knows the old exceptions, plus one player who receives no explanation of which scenery is interactive.
- Scenario and duration: 45-minute camp—river—forest route covering starter supply, touch/desktop navigation, one night segment, torch travel, a plant food loop, harvest, camp maintenance, save export/import, reload, and return to an altered chunk.

## Question

- Primary question: can the player read and operate a dense living rainforest across devices, or do layout, sparse resources, decorative lookalikes and invisible regeneration still force memorization?
- Target player feeling or expected behavior: “I can read this place, choose a tool, act before danger lands, and see the world remember what I did.”
- Hypothesis: a single semantic object source, same-shape/same-base-verb contract, physical hit windows, and local world feedback will turn scenery into a trustworthy survival system.

## Success and failure signals

- Observable success: every sampled discrete tree/rock/resource plant resolves a base action; river resources fit their geography; Director restoration never appears in view; a plantain/banana silhouette leads to a food result; 10–15m torch travel is viable; every panel/equipment verb is reachable on touch; export/import restores the exact altered world.
- Observable failure: two same-looking objects obey different rules; an apparently discrete object cannot be focused; damage occurs from proximity alone; animal motion ignores player/environment; feedback exists only in a panel; a depleted object resets after streaming/reload.
- Time-to-action or completion: once focused, the player predicts the base verb and missing condition within five seconds; quick equipment and fire maintenance require no full-menu search.
- Error, death, retry, or abandonment count:
- Performance boundary such as frame time, memory, or loading: record p50/p95 frame time, active semantic/render object counts by density layer, first chunk activation time, draw submissions, save size after a long-distance route, and mobile input delay.
- Comprehension signal: for at least 90% of sampled objects, the player correctly predicts “what it is, what verb applies, and why the current tool works or fails.”

## Test procedure

1. Starting state: fresh save with an axe/blade path reachable, followed by a restored state with two changed generated objects.
2. Instruction given to the tester: “准备一次穿过雨林与岩地的夜间短途远征并安全返回。” Do not explain which objects are interactive.
3. Object sweep: approach at least ten trees, ten separate rock models, five resource plants, three ground-clutter patches, one water edge, and every nearby camp object; record predicted and actual verbs.
4. Action sweep: equip the appropriate tool, strike a tree and rock, use one deliberately poor tool, collect drops, quick-add fire fuel, switch light source, and organize the resulting inventory.
5. Threat sweep: approach a snake from visible and occluded angles; attempt avoidance and a pre-emptive attack; observe warning, strike window, hit/death state, and persistence.
6. Ecology sweep: follow one non-snake animal for 60 seconds and record reactions to player distance, habitat, weather, food/water, or another animal.
7. Persistence sweep: leave the active chunks, return, save/reload, and verify changed nodes, dead animals, fire/building state, and unchanged-world save growth.
8. Data and artifacts to capture: target screenshots/video, predicted-vs-actual object table, exact action/time sequence, object IDs and state deltas, frame profile, save size, and console errors.

## Device and density gates

1. At 390×844, 844×390 and 667×375, open all seven panels and each equipment slot in no more than two taps; every primary touch target is at least 44px and the reticle keeps a 160×100 clear zone.
2. In every mobile panel, the close action remains visible while only the panel body scrolls; no horizontal overflow or hidden control may be used to reach a core verb.
3. At 1920×1080, inspect UI scale at 80%, 100% and 140%; settings remain readable and do not overlap the reticle or critical HUD.
4. Walk 72m of the physical river route on a fresh seed: count loose hand-pickable stone and fallen vine, and verify every node is outside the water surface but visually belongs to the bank/approach.
5. Deplete at least three renewable nodes, advance time through rest, then watch from the original direction: no node restores inside the forward view or within the protected distance; after leaving and returning, at most the Director's bounded legal result appears.
6. From camp, capture four cardinal views. Each must contain a foreground occluder, a midground leaf/vine mass and a distant canopy silhouette without introducing an unfocusable lookalike of an interactive plant.
7. At dry midnight and full-rain midnight, use the same seed/position/yaw: resource type is recognizable at 10m, terrain direction is readable at 15m, and surfaces within 3m are not blown out.
8. Export a save after changing a tree, resource, animal corpse and structure; import it over a different run, confirm the preview, verify the exact changes, then exercise the pre-import recovery path. Repeat once inside Toy preview on desktop and mobile.

## Observations

- What the player did:
- Where attention went:
- Where hesitation, error, or surprise occurred:
- What the build did:
- Relevant timings, counts, logs, screenshots, or video:

## Interpretation

- Supported, mixed, or rejected:
- Leading explanation:
- Alternative explanation:
- Confidence and uncertainty:

## Decision

- Keep, change, remove, or test again:
- Next smallest experiment:
- Gate requiring user judgment:
- Known limitation carried forward:
