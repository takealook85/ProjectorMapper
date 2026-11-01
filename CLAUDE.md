# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Projection Mapper: a browser app (TypeScript + Vite + WebGL2, no UI framework, no runtime dependencies) that projects effects onto tilted physical surfaces (e.g. the three visible faces of a box seen at 3/4) with real-time perspective correction. Everything user-facing — UI strings, code comments, docs, commit messages — is in **Italian**; keep it that way.

User docs live in `docs/documentazione.md` (full manual, including an architecture section) and `README.md`. When you change behavior, shortcuts, effects or panel controls, update both.

## Commands

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173 (opens the browser; host: true lists all LAN addresses)
npm run build      # tsc --noEmit (type check) + vite build into dist/
npm run preview    # serve dist/
npx tsc --noEmit   # type check only
```

There are no tests and no linter. `npm run build` is the verification step; `tsconfig.json` is strict with `noUnusedLocals`/`noUnusedParameters`, so unused code fails the build. `avvia.bat` is a double-click launcher for Windows (installs deps if missing, then `npm run dev`). `dist/` must be served over HTTP (`vite.config.ts` uses `base: './'`).

## Architecture

`main.ts` constructs `App` (`app.ts`) with four stacked DOM layers from `index.html`, bottom to top: `#gl` (WebGL canvas), `#yt-layer` (YouTube iframes), `#overlay` (2D canvas for handles/crosshair), `#panel` (control panel). `App` owns the scene and runs the `requestAnimationFrame` loop, which each frame calls the renderer, `YouTubeLayer.update`, and draws the overlay.

**Scene model (`state.ts`).** A `Scene` is `{ vertices: Record<id, Vec2>, surfaces: Surface[] }`. Vertices are stored separately and referenced by id from each surface's `v` array (the polygon outline in order, 4..`MAX_VERTICES`), so a shared vertex keeps adjacent faces joined. `corners` holds the indices in `v` of the 4 perspective corners (top-left, top-right, bottom-right, bottom-left); the other vertices only shape the outline (`insertVertex`/`removeVertex`, which keep `corners` in sync and apply to every surface sharing the edge/vertex). Coordinates are normalized 0..1 relative to the projection area. Snapping (`mergeVertex`), detaching (`detachVertex`), group moves (`connectedVertices`) and `pruneVertices` all operate on this shared-vertex graph. `validateScene` fills defaults for missing fields — use it when adding new fields so older saved scenes and imported JSON keep loading.

**Mutation protocol.** Code that modifies the scene calls `app.snapshot()` *before* the change (pushes a JSON copy onto the 100-entry undo stack) and `app.changed(structural)` *after* (debounced 300 ms save to localStorage; `structural = true` also rebuilds the panel and garbage-collects unused media/textures). The panel (`ui.ts`) is rebuilt wholesale from the scene via the small `h()` DOM helper rather than diffed.

**Perspective correction.** `geometry.ts` computes the unit-square→quad homography from the 4 corners in closed form (Heckbert); `surfaceMapping` returns it or null if the surface is invalid (non-convex corners, self-intersecting outline, vertex beyond the horizon) — invalid surfaces aren't rendered and get a red outline. The renderer triangulates the full polygon (ear clipping) and the fragment shader uses the inverse homography per pixel to get content coordinates (u,v), giving exact perspective with no diagonal seam; outside the corner quad u,v leave 0..1. The outline in uv space is passed as `uPoly`/`uPolyN` for feathering and edge-following effects.

**Rendering (`renderer.ts`, `shaders.ts`).** One WebGL2 program with all effects in a single fragment shader, selected by `uniform int uEffect`. Media textures come from `media.ts` (images/videos stored as blobs in IndexedDB, keyed by `mediaId`; not included in JSON export).

**YouTube (`youtube.ts`).** Cross-origin iframes can't be sampled into WebGL, so YouTube surfaces skip the shader (the renderer `continue`s on them unless calibration mode is on) and instead are warped with the same homography applied as a CSS `matrix3d`. Consequently they always sit above shader effects and don't support feathering.

### Adding an effect

The index of an entry in the `EFFECTS` array (`state.ts`) **is** its `uEffect` value in the shader. Insert new effects before `youtube` (and keep `media`/`strobe` indices in mind), add an `else if (uEffect == N)` branch in `shaders.ts` that sets `col` (available: `t` face coords 0..1, `p` centered aspect-corrected coords, `time`, `uC1`, `uC2`, `uScale`), and renumber any shader branches that shifted. The panel menu picks it up automatically.
