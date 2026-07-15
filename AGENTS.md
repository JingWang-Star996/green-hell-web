# Project guidance for CANOPY: First Night

This guidance applies to the entire repository. Use `$orchestrate-game-dev` for implementation, maintenance, debugging, optimization, playtest, polish, and milestone-review work.

## Sources of truth

- Read `PROJECT_BRIEF.md` before planning substantial work.
- Read `PLAYTEST_RUBRIC.md` before judging player experience or polish.
- Append consequential choices to `DECISIONS.md`.
- Preserve explicit non-goals and autonomy boundaries.

## Working model

- Keep one user-facing coordinator responsible for decomposition, integration, verification, and handoff.
- Use one agent by default. Create temporary specialists only for independent, bounded, objectively reviewable work.
- Keep one writer for coupled scenes, prefabs, controllers, state machines, save data, feel stacks, and final integration.
- Base specialization on task contracts and tools, not on job-title personas.

## Engineering rules

- Inspect the current architecture and runnable state before changing them.
- Prefer the thinnest playable vertical slice over speculative frameworks.
- Preserve existing game feel during maintenance unless the brief says otherwise.
- Do not rewrite, migrate engines, expand platforms, or broaden scope without authorization.
- Preserve user changes and unrelated work.
- Never claim a build, test, scene, visual, or performance result was verified unless it was actually run or inspected.

## Project commands

- Install: `npm ci`
- Build: `npm run build` and `npm run build:pages`
- Test: `npm test`
- Run or play: `npm run dev`
- Package: `npm run build:toy`
- Lint or static checks: `npm run typecheck` and `npm run lint`
- Full verification: `npm run verify`
- Performance capture: no repeatable benchmark is defined yet; do not claim performance results without a recorded protocol.

Fill these from repository evidence. Do not invent commands.

## Definition of done

A change is done only when the agreed behavior is implemented and proportionate evidence is recorded. Evidence may include a runnable build, engine-native or automated tests, exact reproduction steps, logs, screenshots, video, packaging output, or before/after performance data.

Report remaining uncertainty and known limitations explicitly.

## Ask before

- changing engine, renderer, platform, core architecture, or save compatibility;
- using paid services, accepting licenses, purchasing assets, or creating recurring cost;
- destructive conversion, bulk migration, data deletion, or history rewriting;
- using credentials, publishing publicly, or contacting external people;
- selecting between materially different aesthetic, narrative, or game-feel directions;
- expanding beyond the current milestone.
