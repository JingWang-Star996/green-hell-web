# CANOPY: First Night — Decision Log

Keep this file append-only. Record choices that constrain future work; do not log routine implementation details.

## 2026-07-14 — Workflow initialized

- Status: accepted
- Decision: Use a single user-facing coordinator, dynamic task-bounded specialists, and evidence-based playable loops.
- Context: Project mode is `vertical-slice`; engine or stack is `Web / Three.js + React + deterministic TypeScript simulation`.
- Options considered: Fixed permanent role agents; unstructured single-agent execution; dependency-driven orchestration.
- Tradeoff: This adds lightweight project memory and validation gates while avoiding permanent coordination overhead.
- Consequence: Scope, evidence, and consequential choices should be kept in the project files.
- Revisit when: The project develops stable independent pipelines that justify persistent specialist configuration.

## 2026-07-14 — Coherent survival time and regeneration

- Status: accepted
- Decision: Use a 48-real-minute authored day, an eight-game-hour rest resolved through the ordinary fixed-step simulation, game-hour food lifetimes, and deterministic per-node random regeneration windows with off-screen materialization.
- Context: The 20-minute day, 25-second partial rest shortcut, very short food deadlines, and fixed whole-node refresh cadence made time unreadable and collection feel synthetic.
- Options considered: Match Green Hell's approximately 24-minute day exactly; keep real-second durations independent; use nondeterministic browser randomness for respawns.
- Tradeoff: The slower clock is less punishing than the reference game's baseline and an eight-hour sleep performs more fixed ticks, but panel-reading time is fairer and save/replay outcomes remain exact.
- Consequence: Calendar time is stored monotonically for legacy compatibility; content lifetimes and growth use explicit game-time conversion; objective/rare entities never regenerate.
- Revisit when: Recorded playtests show a full expedition lacks pressure, rest causes unacceptable input stalls, or resource scarcity cannot support the exploration loop.

## Entry template

Copy this section when a consequential decision is made.

### YYYY-MM-DD — Decision title

- Status: proposed, accepted, superseded, or rejected
- Decision:
- Context:
- Options considered:
- Tradeoff:
- Consequence:
- Revisit when:

## 2026-07-14 — Action completion and panel feedback contract

- Status: accepted
- Decision: Split survival actions into handcrafting, camp maintenance, building, and rest. Handcrafting, treatment, consumption, and maintenance keep their panel open and show an in-panel result; world construction and rest close the panel so their world/time consequence is immediately visible.
- Context: A single flat recipe list hid system messages behind its modal and gave no consistent signal for whether an action had completed or changed the world.
- Options considered: Close every panel after every action; keep every panel open; use only the existing HUD event stack beneath modals.
- Tradeoff: The UI owns a small action-policy table and duplicates the latest event in a top feedback layer, but the deterministic simulation remains the sole owner of outcomes.
- Consequence: New panel actions must declare their intent group and close/retain behavior; retained maintenance actions should expose before/after values when a numeric state changes.
- Revisit when: Placement mode needs a dedicated transition, or playtests show that a retained action interrupts inventory batching.

## 2026-07-14 — Local-first checkpoints with cloud conflict protection

- Status: accepted
- Decision: Every checkpoint commits synchronously to a checksummed local primary/backup pair before an ordered Toy cloud write. Manual saves, new-game first frame, rest, task completion, key milestones, periodic cadence, visibility loss, and page exit are checkpoint triggers. Cloud writes compare revision and simulation tick first; an ambiguous equal-version divergence preserves the existing cloud copy for explicit recovery rather than overwriting it.
- Context: Progress could be erased when repository initialization raced a new run, important actions had no checkpoint, cloud state was invisible, and an older device could overwrite newer Toy progress.
- Options considered: Cloud-first blocking saves; local-only saves; blind last-write-wins cloud sync; autosave on every simulation frame.
- Tradeoff: Title actions can wait up to the bounded Toy read timeout and cloud writes perform a protective read, but gameplay never waits for network durability and cloud failure cannot invalidate a successful local save.
- Consequence: Save UI must distinguish saving, local durability, cloud completion, retryable cloud failure, and local failure. New game requires explicit confirmation when a continuable checkpoint exists, clears primary/backup/quarantine, preserves meta-knowledge, and immediately creates a replacement recovery point. Content v3 remains accepted and is rewritten as v4 on the next checkpoint.
- Revisit when: Toy documents a compare-and-swap API, save payloads approach cloud quota, or multi-slot/manual naming becomes part of the milestone.

## 2026-07-14 - Durable progression outside the event log

- Status: accepted
- Decision: Treat the 256-entry event log as presentation history only. Persist compact `knowledge` arrays for inspected landmarks, observed items, crafted recipes, and announced recipes, plus `progress` booleans for first water collection and completed rest. Every new event updates this memory before log truncation, and migration unions recoverable facts from legacy logs.
- Context: Objective gates and recipe discovery previously queried the bounded event log, so a long session could silently forget clues, water collection, crafting knowledge, and rest after routine events rolled them out.
- Options considered: Make the event log unbounded; enlarge the cap; derive all facts from current inventory/objective flags; keep a compact durable memory.
- Tradeoff: Saves gain a few small arrays and booleans, but log size remains bounded and progression no longer depends on transient UI history.
- Consequence: New one-time discoveries or gates must be represented in durable state (or an existing objective flag) at event-write time; selectors may retain an event-log fallback only for unmigrated saves.
- Revisit when: Progression moves to a versioned journal/quest graph that can subsume these compact fields.

## 2026-07-14 - Placed structures own their spatial semantics

- Status: accepted
- Decision: Resolve survival actions, cover, fire comfort, movement collision, and placement overlap from each built structure's persisted transform. Saves with built flags but no transform use the original authored positions. A shared pure geometry contract supplies placement envelopes, use/cover radii, and model-aware movement footprints to both simulation and renderer.
- Context: Free placement was visually recorded, but sleep, fuel, rain, sanity, and collision still treated the camp anchor as if every structure lived there; players could use distant objects and walk through their models.
- Options considered: Keep camp-radius shortcuts; make every structure a solid circle; derive collision from Three.js meshes at runtime; maintain deterministic code-native footprints.
- Tradeoff: Code-native footprints must stay aligned with model changes, but they are deterministic, testable without WebGL, and let shelters remain enterable by colliding only with their support poles.
- Consequence: Rest requires the placed bed, fuel requires the placed fire, cover follows shelter/bed zones, fire comfort follows local light radius, and all future structure models need explicit geometry data before becoming placeable.
- Revisit when: Multiple structures of the same kind, demolition, or a generalized physics/navigation layer enters scope.

## 2026-07-14 — Explicit equipment and persistent harvest nodes

- Status: accepted
- Decision: Owning a tool and equipping it are separate states. First-person use, snake protection, battery extraction and standing-tree harvest require the appropriate explicitly equipped item. Harvestable trees are deterministic world entities with stable IDs, finite yield, durability/time costs, collision and off-screen regeneration.
- Context: Inventory-only bonuses made weapons and tools invisible abstractions; decorative trees and click-to-pick materials could not support an embodied survival loop.
- Options considered: Keep passive inventory bonuses; make trees renderer-only hit props; model equipment and harvest in the deterministic simulation.
- Tradeoff: Existing tests and player habits must learn `1/2/3/Q`, and world state gains more entities, but replay, saves and streamed chunks keep one authoritative result.
- Consequence: New tool-gated actions must check `player.equippedItem`; rendering may animate an event but may not invent yield or durability changes.
- Revisit when: Two-handed states, ranged attacks, item switching time or animation cancellation require a richer equipment state machine.

## 2026-07-14 — First-generation free placement remains simulation-authoritative

- Status: accepted
- Decision: Campfire, shelter and bed construction enters a world preview with rotate/cancel/confirm. The renderer offers immediate terrain, water, collision and camp-radius guidance; the simulation repeats finite-distance validation and only then consumes materials, advances work and stores the transform. Successful placement is an autosave milestone.
- Context: Fixed-coordinate, menu-only construction was linear and visually disconnected, while trusting only the preview would make state exploitable or nondeterministic.
- Options considered: Keep fixed authored positions; let the renderer own structures; use preview plus authoritative command validation.
- Tradeoff: Preview and simulation share a small validation contract that must remain aligned. This milestone still allows one of each structure and one logical camp.
- Consequence: Rejected placement retains the preview and never consumes materials. Saves and cloud restores must reproduce position and yaw exactly; legacy boolean-only saves receive compatible default transforms.
- Revisit when: Multi-camp ownership, snapping, repeated structures, terrain foundations, dismantling or structural stability enter scope.

## 2026-07-14 — Run epochs and quota-aware Toy cloud records

- Status: accepted
- Decision: Compare `runEpoch` before revision and simulation tick so an explicitly created run always supersedes an older run, even if cloud deletion previously failed. Keep logical save keys stable at the repository boundary, but map them to Toy-valid physical keys and encode each cloud record as a versioned, checksummed gzip/base64 manifest plus chunks sized so UTF-8 key bytes plus UTF-8 value bytes never exceed 1024, each key stays within 128 bytes, and each Toy uses no more than 128 physical keys. Publish a replacement in one batch, then remove excess old chunks; use true host deletion when available and empty tombstones only as a compatibility fallback.
- Context: Resetting local revision to zero could let a stale higher-revision cloud save resurrect after a failed clear. The full save envelope also exceeded Toy's per-item key-plus-value quota, and repository backup keys containing `.` were not legal Toy keys.
- Options considered: Blind last-write-wins; cloud-first new game; local-only saves; truncate the payload; write unversioned chunks; keep using illegal logical keys directly.
- Tradeoff: Compression, manifests and protective reads add CPU and cloud keys. An unusually large save that cannot fit within 128 keys reports a retryable cloud failure instead of partially uploading, while the already-written local primary/backup remains valid.
- Consequence: Cloud decoding fails closed on missing/corrupt chunks; legacy unchunked legal-key values remain readable; new save fields must account for compressed quota growth; tests must enforce Toy key syntax, key/value byte caps, atomic replacement and local durability under cloud failure.
- Revisit when: Toy exposes a larger blob/CAS API, true transactional deletion semantics change, or ordinary saves approach the 128-key ceiling after compression.

## 2026-07-14 — One visible object, one semantic truth

- Status: accepted
- Decision: Generate every discrete tree, rock, resource plant, animal and placed structure once as a stable semantic entity, then render from that entity. Objects with equivalent silhouette, material and scale must expose the same base verb; differences may change tool, duration, risk and yield only when the world and focus feedback communicate them. Continuous terrain and micro-clutter may remain non-interactive only when they cannot be mistaken for a discrete resource object.
- Context: The current chunk pipeline independently creates dense visual trees/rocks and sparse actionable nodes, while ecology projects moving animals without individual combat or lifecycle state. Players therefore cannot infer rules from the world and must discover invisible exceptions.
- Options considered: Add brighter markers only to the existing actionable subset; make every renderer decoration raycastable without simulation state; replace both tracks with one semantic generation source and distance-based render detail.
- Tradeoff: More world objects need stable IDs and active-bubble management, and the renderer loses freedom to invent gameplay-looking scenery. In return, interactions become learnable, streaming becomes testable, and differential saves can preserve only changed entities.
- Consequence: A second same-looking visual-only generator is an architecture violation. New world content must declare identity, capabilities, requirements, feedback, lifecycle and save-delta behavior before receiving a discrete mesh.
- Revisit when: measured browser performance cannot support the semantic density even with instancing, sleeping entities and active-bubble degradation, and an alternate representation still satisfies the same-shape/same-base-verb test.

## 2026-07-14 — Gameplay semantics precede the programmatic visual pass

- Status: accepted
- Decision: Complete world-object consistency, interaction readability, embodied combat/ecology and the first building–biome loop before executing the Valheim-informed visual overhaul. Visual research proceeds in parallel, but implementation consumes stable semantic biome/entity data rather than redefining gameplay through renderer-only decoration.
- Context: Valheim demonstrates that procedural terrain, restrained assets, lighting, fog, vegetation, weather, color and sound can create a rich world within an independent-game footprint. Applying those techniques before fixing the current visual/gameplay split would make the same ambiguity prettier rather than remove it.
- Options considered: Rebuild visuals immediately; postpone all visual research; research now and implement after gameplay gates.
- Tradeoff: The current low-poly presentation remains temporarily plain, while the later visual work gains reliable biome, object and performance inputs and avoids being thrown away by gameplay architecture changes.
- Consequence: The visual milestone must improve biome/resource/hazard readability as well as atmosphere, remain original to CANOPY's tropical setting, and include explicit frame, draw-call, memory and package-size budgets.
- Revisit when: a specific visual limitation prevents accurate interaction playtesting, in which case only the smallest readability fix may move earlier.

## 2026-07-14 - World actions resolve through an interruptible session transaction

- Status: accepted
- Decision: Executable world interactions use a renderer-owned `windup -> hit-window -> recovery` session transaction. The existing simulation command is submitted exactly once on entry to the hit window, after revalidating the same focused target, action, range, line of sight and executability. Losing the target, pausing, opening a panel or hiding the page before that point interrupts with no command; placement remains a separate immediate confirmation path.
- Context: Immediate key-down settlement made tools and weapons feel disembodied, allowed visual motion to lag behind the authoritative result, and could not distinguish a cancelled swing from a successful world action.
- Options considered: Keep immediate commands and play cosmetic animation afterward; move hit tests into a second renderer-only physics system; add a session transaction that consumes the existing focus/capability truth and leaves settlement in the deterministic simulation.
- Tradeoff: Each action now has several hundred milliseconds of intentional lockout and a small amount of non-persistent UI state, but repeated input, pause races and target loss become explicit and testable without duplicating gameplay geometry.
- Consequence: New executable world verbs must declare an animation timing class and travel through the transaction; UI may describe a hit-window as a pending judgement but may only claim success from the simulation event/ActionReceipt. Session action phases are never saved.
- Revisit when: charged, combo, projectile or multi-target actions require animation events richer than the current single-commit transaction.

## 2026-07-14 — Visual work uses one post-gameplay evidence gate

- Status: accepted
- Decision: Treat `docs/VISUAL_MILESTONE_PERFORMANCE_PROTOCOL.md` as the only executable visual gate. After gameplay G0, establish a repeatable browser baseline (V0), reduce per-chunk submissions with active-ring instance pools without changing world identity (V1A), then handle a versioned continuous world field as a separate save/user decision gate (V1B) before expanding original silhouettes, community composition and weather.
- Context: The two Valheim research documents mixed official facts, CANOPY engineering inference and design choices; their draw-call budgets conflicted, and their old 125-semantic-draw estimate predated five tree lifecycle pools and three rock pools per chunk.
- Options considered: Apply the research roadmaps directly; start adding variants against the current per-chunk pools; keep research as inspiration but establish one measured execution protocol.
- Tradeoff: Visual implementation starts later and first pays for benchmarking/pooling, but variants cannot silently multiply draw submissions or overwrite world/save identity.
- Consequence: Static source inventory is reported separately from browser/GPU measurements; every result records seed/build/hardware/route; current Steam 1GB storage and future 1.0 estimated 4.3GiB remain distinct facts; CANOPY does not copy Valheim assets or expression.
- Revisit when: the gameplay gate is complete and V0 evidence supports different numeric budgets, or a measured visual readability defect requires a narrowly scoped pre-gate fix.

## 2026-07-14 - Procedural kills leave sparse authoritative corpses

- Status: accepted
- Decision: Killing a procedurally projected animal freezes its chunk, position and heading in sparse ecology state and places the complete species yield on that corpse. The corpse is projected independently from the current living population count, remains until its pending loot is cleared, and gates respawn even after the scheduled recovery tick.
- Context: Procedural animals previously disappeared on death, rewarded inventory immediately, lost overflow, and could not survive population departure, activity-bubble movement or save/load as physical world consequences.
- Options considered: Keep instant rewards; recompute a corpse from the moving procedural position; attach corpses to current population slots; persist a small death snapshot and pending loot.
- Tradeoff: Every uncleared kill adds a small nested record to the save and corpses are prioritized in the bounded wildlife view pool. In return, hunting, inventory capacity, collection, ecology and persistence now share one observable result.
- Consequence: Kill events must not claim item discovery or possession; only collection events can unlock inventory-derived knowledge. Full inventory rejection changes neither loot nor time. Pure render projection never revives a dead record; ecology refresh is the sole respawn transition.
- Revisit when: long-session corpse accumulation approaches Toy cloud quotas, decay/scavengers should consume corpses, or butchering needs staged tools and yields.

## 2026-07-14 - Continuous river water uses ephemeral reversible targets

- Status: accepted
- Decision: Address a centre-ray hit on the visible river with a strict reversible `water:river:v1:<qx>:<lane>` ID. The target exists only for focus and command settlement; the simulation decodes it, validates the shared river surface, use range, authored/building line of sight and empty container both before and after work, then emits one authoritative collection result. The authored `landmark.stream` command remains load/input compatible but no longer owns a single 3D focus ring.
- Context: A continuous visible river could only be used at one authored hotspot, teaching the player that identical water was arbitrarily inert and encouraging proximity guessing.
- Options considered: Persist thousands of water entities; trust renderer-supplied hit coordinates; keep several authored hotspots; derive a bounded ephemeral identity from the shared river field.
- Tradeoff: The renderer keeps a small focus-only hysteresis so 0.5m quantization does not interrupt normal aim tremor. Line-of-sight currently shares authored landmark and placed-building colliders; generated tree/rock occlusion remains renderer-only until semantic collider queries have a bounded shared index.
- Consequence: River surface width, height offset, wading width and use range are shared terrain constants. Ground, wet mud, blockers and out-of-range hits cannot become water targets; pristine exploration and saves gain no river records or deltas.
- Revisit when: the versioned continuous world field replaces the current fixed river function, or a shared bounded semantic-collider query is available for simulation settlement.

## 2026-07-14 - Physical actions require authoritative first-entry contact

- Status: accepted
- Decision: Player tool/weapon hits and predator contact use the same bounded analytic 2.5D first-entry query over deterministic target and blocker shapes. The renderer may anticipate a hit, but the simulation reconstructs the current pose, target, tool and active-world blockers before writing any yield, durability, wound, health, cooldown or event state.
- Context: Range-only interaction and renderer-local lunges allowed attacks through walls, behind the player or after changing targets, while a preview could visually succeed even when the authoritative endpoint had already changed.
- Options considered: Trust the renderer raycast; use range and facing cones only; add a full mesh-physics engine; share bounded code-native capsules/circles/boxes with exact structure parts.
- Tradeoff: Analytic shapes require explicit maintenance and are not triangle-perfect, but they are deterministic, save-independent, testable without WebGL and hard-capped at 512 blockers with fail-closed overflow.
- Consequence: A visual preview never marks an action successful. Action transactions bind the start target/pose, simulation acceptance owns the result, rejected predator contact can retry, and blocked contact has zero gameplay or cooldown side effects.
- Revisit when: projectiles, climbing or destructible irregular meshes require a versioned spatial index or richer collision representation.

## 2026-07-14 - Wildlife existence is stable and readability is continuous

- Status: accepted
- Decision: An animal inside the active ecology bubble exists independently from weather, time of day and view budget. Those factors may change a continuous readability value, while the renderer selects a bounded view set that protects corpses, focused/action-bound animals, injured individuals, telegraphs and every aware predator before filling ambient slots.
- Context: A three-second visibility reroll made animals blink out, broke pursuit and combat causality, and allowed a newly aware predator to disappear merely because it had not already obtained a render view.
- Options considered: Keep random visibility; increase the reroll interval; equate simulation existence with renderer budget; keep stable projections and make view selection an explicit policy.
- Tradeoff: Protected views may temporarily overflow the normal 10/24 ambient budget and therefore need diagnostics and graceful LOD degradation, but combat and corpse truth are never silently dropped.
- Consequence: `visible` means active-bubble existence; `visibility` means presentation readability. Fog, rain, darkness and performance degradation may change opacity, contrast, animation or LOD, never delete authoritative individuals.
- Revisit when: measured protected overflow needs a separate high-water safety policy or ecology population caps change materially.

## 2026-07-14 - Interaction prompts state the real input contract

- Status: accepted
- Decision: Resolve every focused affordance into one of four modes: `execute`, `inspect`, `movement` or `unavailable`. Only execute/inspect expose an E key or touch button; movement is advice and unavailable is a visible blocker. Desktop HUD, touch UI and command routing consume the same resolved mode.
- Context: A universal interaction prompt made hazards, missing-tool states, ambient observations and executable actions look identical, teaching players to press buttons that could not produce a result.
- Options considered: Keep one prompt and explain failures after input; hide every blocked target; let each UI surface infer its own behavior; expose one shared input-truth field.
- Tradeoff: Blocked targets can remain focusable so the player learns why they are blocked, while the UI must render a non-button status state. Read-only observations may still produce local explanatory feedback without a simulation mutation.
- Consequence: New affordances must declare an interaction mode through the shared resolver and every `execute` projection must map to one authoritative command. Renderer, keyboard and touch code may not invent an actionable prompt from verb text alone.
- Revisit when: dialogue, hold-to-confirm, radial choices or multi-step contextual actions need additional explicit input modes.

## 2026-07-14 - Rain cover belongs to an overhead world structure

- Status: accepted; supersedes the bed-cover portion of "Placed structures own their spatial semantics"
- Decision: A leaf bed is a rest surface and collision object, never an invisible rain roof. Player wetness, torch exposure, fire shelter and processing cover may only consume a real shelter roof, an authored enterable roof/rock overhang, or a future structure with an explicit overhead-cover volume.
- Context: The previous selector and renderer both granted every built bed a 2.8m shelter radius. A bed placed in open rain therefore dried the player and protected the torch despite having no visible overhead geometry, teaching a menu-category rule instead of a world rule.
- Options considered: Keep the bed radius as a convenience bonus; require bed and shelter to overlap but still query the bed; remove bed cover and let the independently placed shelter own protection.
- Tradeoff: A badly placed bed can now be slept in while exposed and wet, so placement matters and the rest result can be worse. In return, every protection claim is visible, spatial and reusable by other systems.
- Consequence: New furniture cannot imply cover from its recipe category. A rest action may advance time under bad conditions; UI and events must describe the actual shelter/fire outcome rather than silently granting safety.
- Revisit when: modular roofs replace the current shelter coverage approximation, at which point cover should be resolved from roof volumes/cells rather than a radial proxy.

## 2026-07-14 - Continuous water focus and settlement share strict first-entry occlusion

- Status: accepted; supersedes the temporary collider limitation in "Continuous river water uses ephemeral reversible targets"
- Decision: Continuous river and authored-water use rebuild a hand-to-surface 2.5D sweep and compare the target surface against exact authored, semantic tree/rock/fallen-object and placed-structure parts. The query is capped at 512 blockers and fails closed; target containment never excuses an unrelated blocker.
- Context: A broad placement circle rejected valid reach through a shelter opening, while renderer-only semantic occlusion could show a focus that authoritative collection later rejected. Both were consequences of different consumers approximating the same reach action.
- Options considered: Keep broad structure radii; trust the renderer focus; persist water hotspots; share the bounded active-world first-entry query with explicit target ownership.
- Tradeoff: Every discrete world family needs a maintained analytic collider and the focus path must request strict water occlusion. In return, openings, supports, trees, rocks and structures produce the same observable answer in presentation and settlement.
- Consequence: Water targets remain ephemeral and add no save deltas. New blockers enter one bounded world-hit source; a renderer must not skip a collider merely because that collider geometrically contains the water endpoint.
- Revisit when: a versioned spatial index replaces active-world enumeration or the continuous river field changes identity/version.

## 2026-07-14 - Wildlife rendering has a bounded emergency continuity lane

- Status: accepted; refines "Wildlife existence is stable and readability is continuous"
- Decision: Normal wildlife view budgets remain 10 on low-power devices and 24 otherwise. Focus/action-bound animals and nearest active threats outrank corpses, injuries and ambience; protected continuity may overflow into a deterministic emergency lane, but Three.js view creation is hard-capped at `normal + max(8, ceil(normal * 0.5))` and reports deferred protected candidates.
- Context: Preserving every corpse, injury and aware predator without a hard ceiling allowed a corrupt or extremely long sparse save to create arbitrarily many independent geometries and materials. A diagnostic that only counted overflow did not prevent the allocation.
- Options considered: Drop all overflow at the normal budget; preserve all protected views; instance every actor immediately; retain a bounded emergency lane with explicit priority and diagnostics.
- Tradeoff: In pathological states, distant corpses/injuries and then farther threats can be temporarily deferred from rendering while their authoritative ecology records remain intact. Normal play keeps continuity and imminent/focused actors win deterministically.
- Consequence: View budget never changes animal existence, loot or save state. Runtime diagnostics must distinguish selected protected views from protected candidates deferred by the hard cap.
- Revisit when: pooled/instanced actor LOD can support a larger measured cap or a gameplay design intentionally raises active-bubble population density.

## 2026-07-14 - Ignition is one world rule at preflight and settlement

- Status: accepted
- Decision: New campfire placement and relighting consume the same pure ignition predicate, the same blocking rain threshold and the same real shelter transforms. Both actions check once before work and again after elapsed simulation time; an exposed-storm rejection consumes no ingredients and emits no fuel/ignition/success event.
- Context: A campfire could be built and lit in a full exposed downpour while the same fire, once extinguished, refused to relight. UI, affordance and craft settlement therefore described different physics for the same flame.
- Options considered: Allow construction to bypass weather; make relighting permissive too; duplicate rain checks in each action; share a location-aware predicate across preview, UI and simulation.
- Tradeoff: A storm can force the player to build the leaf shelter before the fire and may invalidate a placement during its 45-second work period. In return, the resulting order is learnable from visible rain/roof geometry and remains deterministic through rest and save/load.
- Consequence: Future flame-bearing structures must declare their own explicit ignition environment or reuse this contract; a recipe category or cached `sheltered` boolean may not grant fire.
- Revisit when: wind direction, wet fuel quality or manual ignition tools become authoritative inputs.

## 2026-07-14 - Campfire audiovisual feedback starts on one presentation clock

- Status: accepted
- Decision: Authoritative events describe what happened, the campfire rig schedules bounded session-only visual beats, and audio starts from the rig's actual transient-start callback. Opening a panel freezes gameplay/input but keeps a lightweight presentation RAF; suspended audio contexts retain at most eight pending cues and mark an event seen only after it can be scheduled.
- Context: Adding fuel from a panel played audio immediately while the paused renderer delayed the falling log and sparks until panel close. A cold relight also queued two serial visual beats while playing both sounds at once, and old fire loops could survive briefly into a new run.
- Options considered: Close every panel after an action; play sound immediately and accept drift; let each effect own a separate clock; preserve one presentation clock with bounded pending audio and synchronous run reset.
- Tradeoff: The renderer continues a small non-gameplay update while menus are open and audio needs an explicit pending/seen lifecycle. In return, feedback is causal, reduced-motion remains informative, and a new/load transition cannot leak old sound or particles.
- Consequence: Panel state cannot delay world feedback that already settled. Coalesced relight events form one audiovisual beat, explicit mute consumes pending cues, and all transparent flame particles disable depth writes.
- Revisit when: a general timeline/mixer replaces the campfire-specific rig or background-tab policy requires a different user-facing replay rule.

## 2026-07-15 - Rainforest depth fill is explicit non-interactive world content

- Status: accepted
- Decision: Increase the bounded semantic tree baseline, add `ambient-foliage` as deterministic `never-focus` depth fill, and reserve clear walking envelopes along the river and three authored first-night routes. Interactive wild plantain remains a separate harvestable silhouette and temporarily resolves to the existing edible `palm-fruit` inventory contract.
- Context: Sparse same-sized trunks and tiny ground clutter left the generated world visually empty. Reusing harvestable silhouettes as decoration would restore density by teaching the player that identical-looking plants sometimes ignore the same verb.
- Options considered: Multiply all interactive resources; add renderer-only random foliage; use one semantic plan with an explicit non-interactive category and density/route budgets.
- Tradeoff: The standard 5x5 active ring adds up to one ambient and one plantain instanced draw per populated chunk, while low detail deterministically halves only ambient records. Plantain does not yet own a distinct inventory item or processing recipe.
- Consequence: Depth-fill shapes may never expose focus, collision, yield or resource landmarks. New density work must remain deterministic, stay within `SEMANTIC_DENSITY_BUDGET`, and preserve landmark/route/river clearances; edible plantain is already testable through harvest-to-eat.
- Revisit when: measured browser profiling supports global foliage pools, a dedicated plantain cooking/decay balance is introduced, or continuous terrain routing replaces the authored corridor guarantees.

## 2026-07-15 - Critical state feedback is causal, graded and multimodal

- Status: accepted
- Decision: Authoritative simulation facts produce graded `observe`, `warning`, `critical` and immediate `impact` signals. Every game-critical negative state uses a readable label plus a non-colour visual signifier, and direct damage also emits an audio event; reliable source direction is shown only when authoritative geometry supplies it. Death freezes a bounded causal summary containing a direct cause, earlier player-changeable facts and a countermeasure already present in player knowledge.
- Context: Players could lose health or die while only seeing small meter changes and generic recent events. Strong rain, modal panels, mobile layout and colour perception could hide the only available cue, while “health reached zero” did not explain the failure.
- Options considered: Enlarge the health bar; show every event as a toast; use a red vignette for all harm; build one causal signal model shared by HUD, body inspection, audio and death review.
- Tradeoff: Damage and condition sources need stable cause codes, bounded incident memory and hysteresis. In return, warnings remain explainable and testable rather than being presentation guesses.
- Consequence: New hazards are incomplete until they declare a cause, severity transitions and at least one actionable or explicitly unknown response. Colour and generic HP loss may reinforce but never replace that contract.
- Revisit when: spatial audio/haptics or a full limb injury model adds another authoritative feedback channel.

## 2026-07-15 - Saves are a player-visible checkpoint timeline

- Status: accepted; refines the primary/backup checkpoint decision
- Decision: Manual slots and rotating autosaves are separate namespaces; autosaves never replace manual saves. Rest commits a verified local checkpoint before advancing time, and a second checkpoint only after a surviving usable result. Death opens a timeline that recommends the newest safe checkpoint but lets the player inspect and select earlier checkpoints by location, objective, status and reason. Local success precedes asynchronous Toy cloud sync, and UI distinguishes local-only, cloud-mirrored and session-only durability.
- Context: A primary/backup implementation protected bytes but did not give players meaningful rollback. Refreshing after late progress could return to the opening, and a single newest autosave could preserve a bad or guaranteed-failure state.
- Options considered: One quicksave plus backup; save only after rest; restart the current day on death; retain 3 manual slots, a configurable rotating automatic timeline and a pre-import recovery point.
- Tradeoff: Multiple envelopes require a manifest, quota budget, slot-level verification and clearer conflict UI. In return, death remains consequential without erasing hours, and import/cloud/storage failures are recoverable and honestly reported.
- Consequence: Dead, half-written, importing or deterministically doomed states cannot become the only newest recovery path. Export/import must treat files as untrusted and preserve a rollback checkpoint before replacement.
- Revisit when: measured Toy cloud quotas require changing the number of mirrored automatic slots; the local timeline contract remains unchanged.

## 2026-07-15 - The existing rescue loop is a prologue to a three-hour first chapter

- Status: accepted; supersedes treating the 24–28 minute vertical slice as a complete campaign
- Decision: “First Night → weather station battery → camp radio” is the prologue. The first chapter, “Lost River Valley”, is structured by delayed radio messages and four order-tolerant ecological investigations—river level, canopy wind, blackwater soil and ridge relay—followed by a signal-priority choice. Each chapter segment must include preparation, a world-readable fact, a persistent world change and a route/building choice; ordinary survival loops count toward the 2.5–3.5 hour first-play target, repeated material quotas do not.
- Context: The current task line ended immediately after teaching the controls, so content volume and the living-rainforest promise diverged. Simply multiplying collection requirements would make the demo longer without creating a campaign.
- Options considered: Extend the battery fetch with more items; write a linear sequence of radio errands; keep a pure sandbox; use soft radio structure around biome-specific survival expeditions and free-building consequences.
- Tradeoff: Story facts, objectives, ecology and building persistence must share one data model and support early discovery, which costs more than scripting a fixed checklist. In return, narrative explains why the player explores while leaving survival decisions to the player.
- Consequence: Objective stage cannot make an otherwise natural object non-interactive. Special communication landmarks may be unique, while normal camp, route and processing structures support multiple instances and locations.
- Revisit when: A1 river-level vertical-slice playtests show whether the target duration comes from decisions and traversal rather than hidden grind.

## 2026-07-15 - Ordinary structures are repeatable local infrastructure

- Status: accepted; supersedes the one-of-each limit in first-generation free placement
- Decision: Campfires, leaf shelters, palm beds, smoking racks, rain collectors and torch waymarks may be placed repeatedly wherever terrain, overlap, resources and world bounds allow. Every campfire owns its own fuel, rain exposure, cover and lit state; structure actions and local effects resolve from an exact structure ID or the nearest eligible instance. The rescue radio beacon remains a unique story facility.
- Context: Free placement still behaved like a linear checklist because the first campfire, shelter or bed disabled its recipe, ordinary construction was confined to an invisible eight-metre camp circle, and fire/runtime/render logic always selected the first instance.
- Options considered: Add multiple named camps; retain singleton survival state but draw duplicate props; make placed structures the runtime truth while preserving old fields as a migration facade.
- Tradeoff: Saves and rendering carry per-instance runtime and legacy fields must be synchronized during the transition. In return, expedition camps, route shelters and distributed processing become real player choices without inventing a second camp system.
- Consequence: `camp.structures` is authoritative for ordinary buildings. New structure actions must carry `structureId`, proximity queries must consider every instance, and renderer projections must not collapse repeated structures. Demolition, upgrades and spatial chunk indexing remain later milestones.
- Revisit when: Dismantling or structural upgrades require ownership graphs, or structure counts justify chunk-indexed simulation and renderer pools.

## 2026-07-15 - Felled ordinary trees regrow through persistent visible stages

- Status: accepted
- Decision: A fully processed ordinary renewable tree enters a sparse deterministic regrowth schedule owned by its stable world identity. It remains a stump for at least two game days, then becomes a sapling, a young tree and finally a mature tree over an approximately seven-to-ten-game-day cycle. Each stage has its own visible scale, durability and yield; long rests and unloaded chunks advance against absolute scheduled ticks without spawning a mature tree immediately beside the player. Authored objective, rare and explicitly nonrenewable trees never enter this lifecycle, and the resource Director remains unable to accelerate it.
- Context: The harvest loop already ended in a persistent stump, but the player's explicit expectation was that a living game rainforest should slowly recover, visibly starting small rather than using the ordinary resource refill rule. Permanent stumps made long runs ecologically static, while an instant tree refill would erase route and building consequences.
- Options considered: Leave stumps permanent; let the ordinary resource Director refill full trees; reroll new tree positions; retain the stable tree identity and persist a staged schedule.
- Tradeoff: Sparse saves need a new versioned tree-regrowth field and render/interaction projections must use the effective stage rather than the deterministic baseline morphology. The user explicitly stated that research-phase legacy saves need not be preserved; older supported compact payloads still fail closed or migrate, but current generator/state truth takes priority.
- Consequence: Tree growth may never be represented by renderer-only scale or by changing an unrelated resource node. Saves, chunk streaming, rest fast-forward, tool requirements, affordance text and render geometry must agree on the same stage. Cutting a sapling restarts the lifecycle and cannot grant mature-tree yield.
- Revisit when: forest succession, canopy gaps, fire ecology, planting or player-selected species require a population-level forestry model rather than per-tree recovery.

## 2026-07-16 - Dynamic collision changes must preserve a physical escape path

- Status: accepted
- Decision: A world-state transition may place a collider around the player only if subsequent movement can reduce that exact collider's penetration without entering, deepening or exchanging into another obstacle. Completed tree stumps remain visible and focusable but are treated as low step-over geometry; standing and fallen trunks remain movement blockers.
- Context: Felling a tree changed its standing circle into a fallen capsule around the current player position. Endpoint-only collision checks then rejected every attempted step, while the finished low stump continued to behave like an invisible full-height wall.
- Options considered: Teleport the player after every tree phase; disable all fallen-tree collision; keep boolean collision and special-case one tree; expose per-collider penetration and enforce monotonic escape.
- Tradeoff: Movement now evaluates penetration per active collider, and renderer pools must explicitly distinguish visible geometry from movement-blocking geometry. In return, dynamic trees cannot trap the player or create a generic wall-traversal exploit.
- Consequence: Any future moving, growing, collapsing or player-built collider must use the same escape invariant or perform an explicit, tested depenetration transaction. Low remnants may remain interactable without automatically blocking locomotion.
- Revisit when: vertical stepping, crouching or a full swept-character controller makes height-aware collision authoritative.

## 2026-07-16 - Mobile persistent hazards use compact disclosure, not permanent cards

- Status: accepted
- Decision: On touch layouts, persistent state conditions collapse to one 44px summary naming the most urgent condition and the number of additional conditions. The player deliberately expands a bounded, scrollable list for consequences and actions; immediate damage impacts temporarily take visual priority. Desktop retains the full persistent stack.
- Context: The original desktop-sized “留意” card remained open in portrait play and covered the world and controls even though its information changed slowly.
- Options considered: Hide persistent hazards on mobile; auto-dismiss them like event toasts; keep the full cards; retain urgency through a compact disclosure control.
- Tradeoff: One tap is required to read detailed treatment advice. In return, the condition remains discoverable without reserving a large permanent rectangle over the playfield, and multiple conditions are not silently discarded.
- Consequence: New persistent warnings must fit the shared summary/list model and may not add their own always-open mobile overlay. Expanded lists must preserve every active condition and all actionable destinations.
- Revisit when: a dedicated mobile status ribbon or controller/haptic channel replaces the current disclosure pattern.

## 2026-07-16 - Reversible building starts with an exact atomic dismantle transaction

- Status: accepted
- Decision: The first dismantle slice applies only to concrete persisted smoke racks and rain collectors. It resolves by exact structure ID, validates proximity, payload state and full refund capacity before and after represented work time, then removes the structure and grants a version-stable per-item refund in one settlement. A confirmation card exposes refunds and rainwater loss; success creates a milestone autosave.
- Context: Repeatable free placement made an accidental location permanent. A generic sell button would hide world distance, duplicate materials when state changed, discard active food, or let future recipe balance rewrite old refund expectations.
- Options considered: Free instant deletion; current-recipe percentage refunds; dropping overflow on the ground; a global building list; a world-context, two-step atomic transaction with explicit first-version scope.
- Tradeoff: Fires, beds, shelters, waymarks and the story beacon remain non-removable until their fuel, rest, coverage and legacy facades have explicit ownership rules. In return, the shipped slice cannot partially refund, delete the wrong instance or silently destroy rack contents.
- Consequence: New removable structures require an explicit refund table, payload-loss policy, preflight and settlement validation, desktop/touch context access, success receipt and persistence test. Historical objective facts are not rolled back when infrastructure is later removed.
- Revisit when: storage, upgrades, foundation graphs or safe removal of stateful fire/rest/route structures enter scope.

## 2026-07-16 - The first dismantle slice never discards structure payload

- Status: accepted; refines the same-day atomic dismantle decision
- Decision: A smoking rack can be dismantled only when it has no active, ready or spoiled batch; a rain collector can be dismantled only when its stored amount is zero. Both conditions are checked before represented work and again at settlement. The confirmation card describes only the version-stable material refund because this slice has no accepted payload-loss path.
- Context: Exposing a rainwater-loss warning still made a routine relocation silently destroy a player-owned survival resource, and fractional collector state made a generic “spill the rest” rule hard to explain consistently.
- Options considered: Allow confirmed water loss; convert remaining water into inventory regardless of containers; drop a new world pickup; require the first supported structures to be empty.
- Tradeoff: A player may need to finish or clear a rack and fully empty a collector before relocation. In return, dismantling cannot erase food or water, bypass container capacity, or invent an unimplemented ground-drop system.
- Consequence: Player copy, Wiki, tests and future removable structures must distinguish a blocked payload from an explicitly designed loss policy. No confirmation dialog may be treated as permission for an undocumented destructive side effect.
- Revisit when: physical storage, world drops or a deliberate drain action provides a visible, persisted destination for remaining payload.
