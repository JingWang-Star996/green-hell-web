# CANOPY: First Night — Playtest Rubric

Use this file to test a question, not to collect vague impressions. Record observations separately from interpretations.

## Build under test

- Date: 2026-07-16
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
8. Building reversibility sweep: place two smoke racks and one rain collector; verify busy racks reject dismantling, a collector reports exact stored-water loss, full refund inventory rejects atomically, and one exact selected instance disappears while its neighbour survives reload.
9. Data and artifacts to capture: target screenshots/video, predicted-vs-actual object table, exact action/time sequence, object IDs and state deltas, frame profile, save size, and console errors.

## Device and density gates

1. At 390×844, 844×390 and 667×375, open all seven panels and each equipment slot in no more than two taps; every primary touch target is at least 44px and the reticle keeps a 160×100 clear zone.
2. In every mobile panel, the close action remains visible while only the panel body scrolls; no horizontal overflow or hidden control may be used to reach a core verb.
3. At 1920×1080, inspect UI scale at 80%, 100% and 140%; settings remain readable and do not overlap the reticle or critical HUD.
4. Walk 72m of the physical river route on a fresh seed: count loose hand-pickable stone and fallen vine, and verify every node is outside the water surface but visually belongs to the bank/approach.
5. Deplete at least three renewable nodes, advance time through rest, then watch from the original direction: no node restores inside the forward view or within the protected distance; after leaving and returning, at most the Director's bounded legal result appears.
6. From camp, capture four cardinal views. Each must contain a foreground occluder, a midground leaf/vine mass and a distant canopy silhouette without introducing an unfocusable lookalike of an interactive plant.
7. At dry midnight and full-rain midnight, use the same seed/position/yaw: resource type is recognizable at 10m, terrain direction is readable at 15m, and surfaces within 3m are not blown out.
8. Export a save after changing a tree, resource, animal corpse and structure; import it over a different run, confirm the preview, verify the exact changes, then exercise the pre-import recovery path. Repeat once inside Toy preview on desktop and mobile.
9. At desktop and both phone orientations, focus an empty smoke rack and rain collector: PC exposes R, touch exposes a 44px action, cancel owns default focus, confirmation lists every refund and water loss, and success creates a milestone recovery point.

## Observations

- What the player did:
- Where attention went:
- Where hesitation, error, or surprise occurred:
- What the build did:
- Relevant timings, counts, logs, screenshots, or video:

### 2026-07-16 — Mobile status, pause menu and tree-collision focused pass

- What the player did: started a fresh run at 390×844, expanded and collapsed the initial open-wound warning, opened ESC, changed sections with ArrowRight, then inspected the same pause state at 844×390.
- Where attention went: the one-line “留意 / 开放伤口” summary remained discoverable without owning the centre of the screen; ESC presented one primary return action and four named categories instead of one long mixed page.
- What the build did: portrait summary measured 220×44 at x158/y268 and had zero overlap with the objective, vitals, touch action or survival-menu button. Expanded details measured 224px high, exposed the treatment action and used bounded vertical scrolling. Portrait ESC stayed within 390×844, hid the redundant seven-item system navigator and kept all four category targets at 44px. At 844×390 the panel body scrolled vertically, the four tabs remained 44px and ArrowRight transferred both selection and focus.
- Relevant timings, counts, logs, screenshots, or video: the first landscape pass found a 2px edge overlap between the 44px warning summary and event/save feedback; their compact-landscape top offset was moved from 96px to 104px and locked by a CSS contract test. The rebuilt Toy entry closure passed, but browser security policy prevented a second local reload after that final 8px spacing change, so the final offset has build/test evidence rather than a second screenshot. Tree escape was covered by per-collider geometry and tree-pool tests, not a full axe-playthrough in this focused pass.

## Interpretation

- Supported, mixed, or rejected:
- Leading explanation:
- Alternative explanation:
- Confidence and uncertainty:

### 2026-07-16 interpretation

- Supported: compact disclosure removes the persistent portrait obstruction while preserving urgency and the complete condition list; ESC category separation materially reduces initial choice load on both phone orientations.
- Confidence and uncertainty: high for measured layout, focus order and deterministic collision contracts; medium for real-device touch feel and post-felling camera/body motion until the axe sequence is replayed in an actual Toy WebView.

## Decision

- Keep, change, remove, or test again:
- Next smallest experiment:
- Gate requiring user judgment:
- Known limitation carried forward:

### 2026-07-16 decision

- Keep: compact persistent-state summary, four-section ESC information architecture, keyboard tab navigation and low-stump step-over behavior.
- Next smallest experiment: fell one semantic tree while standing inside both its old trunk radius and future fall capsule on a real phone, then verify outward movement, re-entry blocking and camera stability without debug repositioning.
- Known limitation carried forward: the final 104px compact-landscape spacing still needs one Toy WebView screenshot after publication; this does not block the local build because the relevant CSS contract, typecheck and Toy closure verification pass.
