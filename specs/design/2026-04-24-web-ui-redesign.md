# Web UI redesign on Hono

Date: 2026-04-24
Status: Implemented locally
Scope: `src/server/` — the `atc-server` HTTP adapter and its built-in web UI

## Goal

Replace the previous hand-rolled single-string web UI with a redesigned interface that matches the provided mocks (Simple mode + Advanced mode), built on Hono. Keep behavior local-only during development: no PRs, no git commits initiated from this work unless the user explicitly asks later.

The redesign is visually close to the mocks but not pixel-perfect. This capabilities copy promotes file attachments and GitHub sign-in from visual stubs into local server-backed functionality.

## Non-goals

- No history persistence, Sync Status endpoint, Add Repository flow, or Discover GitHub flow in the web UI yet. These remain visual stubs only.
- No pixel-perfect parity. Visual and conceptual closeness is enough.
- No frontend build step or SPA framework. No bundler.
- No change to the CLI (`atc`) or to shared `src/core/` logic.

## Dependencies

### Runtime dependencies (package.json)

Exactly two new entries in `dependencies`:
- `hono` — server framework, zero runtime deps, ships its own JSX runtime.
- `@hono/node-server` — official Node adapter, includes `serveStatic`.

No new devDependencies. No bundler.

### Vendored browser assets (not package.json dependencies)

Markdown rendering runs entirely in the browser, so the parser and sanitizer are vendored `.min.js` files under `src/server/ui/assets/vendor/` and committed to the repo. They never appear in `package.json`.

Each vendored file is committed alongside a `<name>.min.js.provenance.txt` sidecar recording:
- pinned version,
- upstream source URL (the exact release asset, not a CDN),
- SHA-256 checksum of the file,
- license (SPDX identifier),
- date fetched.

Updating a vendored library requires updating the sidecar in the same commit. CI (later) may assert the checksum matches the file; for this work, the sidecar is enough.

- `marked` — vendored as `src/server/ui/assets/vendor/marked.min.js`. Pin to a specific 14.x release. Justified by AGENTS.md's "materially simplify" clause: a hand-rolled renderer covering headings, lists, bold, inline code, paragraphs, and code fences would be ~100 lines and still miss edge cases. License: MIT.
- `DOMPurify` — vendored as `src/server/ui/assets/vendor/purify.min.js`. Pin to a specific 3.x release. Required because modern `marked` does not sanitize output and explicitly recommends DOMPurify. Without a sanitizer, answer text from Codex (untrusted) fed through `innerHTML` would be a live XSS sink. License: dual Apache-2.0 / MPL-2.0.

The render pipeline is `marked.parse(text) → DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) → element.innerHTML`. Both libraries are loaded once at page load as non-module `<script>` tags; no CDN.

## Architecture

### File layout (end state, after Step 5)

```
src/server/
  main.ts                       entry — unchanged signature
  args.ts                       unchanged
  app.ts                        builds the Hono app, mounts routes and static assets
  routes/
    ask.ts                      POST /ask, GET /jobs/:id, GET /jobs/:id/events (SSE)
    repos.ts                    GET /repos
    health.ts                   GET /health
    ui.ts                       GET /, GET /ui/assets/*
  ui/
    pages/
      app-page.tsx              root layout; renders Simple or Advanced based on query/header
    components/
      header.tsx
      logo.tsx                  shared ATC logo image
      sidebar.tsx               advanced-mode left nav
      mode-switch.tsx           Simple/Advanced tabs
      ask-card.tsx              question + drop zone + submit
      drop-zone.tsx
      file-list.tsx
      progress-panel.tsx        5-stage pipeline
      after-the-run.tsx         repos used + run summary
      options-panel.tsx         advanced-only: audience/model/etc.
      answer-card.tsx
      empty-state.tsx           reused by stub pages
    assets/
      styles.css                single stylesheet, CSS custom props for light/dark
      app.js                    vanilla JS: SSE, mode toggle, theme, drop zone, view routing
      stage-mapping.js          pure browser-usable helper: status message → pipeline stage
      stage-mapping.d.ts        type sidecar so server-side `.tsx` components can import it too
      logo.svg                  also available as a static asset for favicons later
      vendor/
        marked.min.js           vendored, see Dependencies section for pinning
        purify.min.js           vendored, see Dependencies section for pinning
```

### Transitional files

The previous raw HTTP handler and single-string browser UI have been removed. API behavior now lives in `src/server/routes/*`, while the built-in UI is rendered from Hono JSX components and static assets.

### JSX configuration

`tsconfig.json` additions:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  }
}
```

No React. Hono ships its own JSX runtime and types. `.tsx` files are compiled by `tsc` as part of the existing build pipeline.

### Asset pipeline

- `src/server/ui/assets/**` is copied to `dist/server/ui/assets/**` by a new `scripts/copy-ui-assets.mjs`, invoked from the existing `postbuild` chain.
- In dev (`npm run server` via `tsx`), assets are served directly out of `src/server/ui/assets/`.
- The Hono app resolves the asset root at startup from `import.meta.url`: if the file path contains `/dist/`, use the sibling `dist/server/ui/assets/`; otherwise use `src/server/ui/assets/`. Tested by the Step 1 smoke test.

### Server wiring

- `src/server/main.ts` calls `createApp()` from `app.ts`, then serves it via `@hono/node-server`'s `serve()`. It preserves the current startup logging, config-path announcement, and graceful shutdown semantics.
- `createApp()` wires routes in this order: static assets → UI page → API routes → 404 JSON fallback.

### Backwards compatibility during migration

Hono sits in front of every request. For paths Hono doesn't own yet, a **catch-all Hono middleware** forwards to the existing `createHttpHandler` using the official `HttpBindings` from `@hono/node-server`:

```ts
// src/server/app.ts (Step 1)
import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";

export function createApp(legacyHandler: LegacyHandler): Hono<{ Bindings: HttpBindings }> {
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.get("/ui/assets/*", serveStaticMiddleware);
  // Step 2 adds: app.get("/", uiPageHandler);
  // Step 4 adds: app.route("/ask", ...), app.route("/repos", ...), etc.

  app.all("*", async (c) => {
    await new Promise<void>((resolve, reject) => {
      c.env.outgoing.on("finish", resolve);
      c.env.outgoing.on("close", resolve);
      c.env.outgoing.on("error", reject);
      legacyHandler(c.env.incoming, c.env.outgoing);
    });
    return c.body(null);
  });

  return app;
}
```

`c.env.incoming` (an `IncomingMessage`) and `c.env.outgoing` (a `ServerResponse`) are the officially documented bindings exposed by `@hono/node-server`. They are the same objects the existing handler already expects, so `createHttpHandler` runs unmodified.

`main.ts` serves the Hono app via `@hono/node-server`'s `serve()` — a single HTTP listener, no custom dispatch. As routes migrate in Step 4, the catch-all shrinks in responsibility until it's empty; Step 4 deletes the catch-all along with `http-server.ts`.

Trade-off considered: a listener-level dispatcher (Hono vs legacy by path prefix, before Hono sees the request) is an alternative. Rejected because it introduces a second, transient routing mechanism whose only purpose is to be removed at Step 4, while the middleware approach uses official Hono APIs and collapses naturally to the end state.

## UI structure

### Routes served by the UI

- `GET /` — single app page. Mode (Simple | Advanced) is selected **on the server** from two inputs, in priority order:
  1. `?mode=simple` or `?mode=advanced` query string — highest priority; the response also sets the `atc_mode` cookie to match so future loads stick.
  2. `atc_mode` cookie — read from `Cookie` header.
  3. Default: `simple`.
  Client-side localStorage is NOT part of this resolution. When the user flips the Simple/Advanced switch in the UI, the client writes the `atc_mode` cookie via `document.cookie` with attributes `Path=/; Max-Age=31536000; SameSite=Lax` (one year, so mode survives browser restarts), updates the DOM to the new mode without reloading, and updates the URL's `?mode=` via `history.replaceState` so reloads are consistent. The server sets the same attributes when it writes the cookie in response to a `?mode=` query. This keeps the server's first-byte render correct and avoids a client-side hydration flip.
- `GET /ui/assets/*` — static assets.
- Sidebar nav in Advanced mode uses hash-based view state: `/#new-ask` (default), `/#history`, `/#repos`, `/#sync-status`, `/#config-path`, `/#edit-config`, `/#init-config`, `/#discover`, `/#add-repository`.

### Simple mode

Header:
- Rainbow ATC logo.
- Title line "ask-the-code".
- Theme toggle (sun/moon icon).
- "Sign in with GitHub" button.

Main column (~2/3 width):
- Ask card: question textarea; attach-files control and drop zone (stub); Ask button.
- Answer card: appears after submit; markdown-rendered answer; Copy + Download Markdown buttons.

Right column (~1/3 width):
- Progress panel: 5 stages (Job Created, Repo Selection, Repository Sync, Codex Execution, Synthesis), each with a state (waiting/running/ok/failed), optional timestamp, and subtext. "View Full Log" button expands the raw status log inline.
- After-the-run panel: empty state initially; on completion, shows selected repos with paths.

### Advanced mode

Left sidebar (dark):
- Header area: rainbow ATC logo, "ask-the-code".
- Sections:
  - ASK — Ask (active), History (count, stub empty state).
  - REPOSITORIES — All Repositories (functional, lists from `/repos`), Sync Status (stub).
  - CONFIG — Config Path, Edit Config, Init Config (all stubs).
  - TOOLS — Discover GitHub, Add Repository (stubs).
- Footer: `ATC v{version}`.

Top row of main area:
- Simple/Advanced tab switch.

Main column:
- Ask card (same as Simple).
- Answer card.
- Previous question strip below — empty state (stub; shows nothing when no history).

Right column:
- Options panel (collapsible): Audience (General/Codebase), Model select, Reasoning effort select, Repo selection mode select, Skip repository sync toggle, No synthesis toggle. **These are functional, not stubs.** When Advanced mode is active, every non-default value is serialized into the `POST /ask` request body (`audience`, `model`, `reasoningEffort`, `selectionMode`, `noSync`, `noSynthesis`) — the backend already accepts all of these fields. In Simple mode, the Options panel is not rendered and the request uses backend defaults. The existing `selectionShadowCompare` diagnostic checkbox stays in Advanced's Options panel and is serialized the same way.
- Progress panel (same as Simple, with Job ID visible in the Job Created row).
- Run summary: Repositories used (count + names), Total duration, Steps completed, plus a "Completed successfully" badge on success.

### Stub behaviors

| Element | Stub behavior |
|---|---|
| Sign in with GitHub | Functional when `ATC_GITHUB_CLIENT_ID`, `ATC_GITHUB_CLIENT_SECRET`, and `ATC_AUTH_SECRET` are configured; the Ask button is disabled until the user is signed in. Signed sessions use a 30-day sliding expiry. Otherwise click reports that GitHub SSO is not configured. |
| File drop + file list | Accepts drops and click-to-browse; reads file content in the browser; sends attachments in `/ask`. |
| History (sidebar, count=0) | Empty state: "No previous questions yet." No persistence. |
| Previous-question strip | Same empty state. Hidden when no history. |
| Sync Status page | Empty state: "Sync status view is coming soon." No endpoint call. |
| All Repositories | Functional. Reuses `/repos`. Lists name, default branch, aliases, description. |
| Config Path / Edit / Init | Stub pages — descriptive text + "Not available in the web UI yet." |
| Discover GitHub | Stub page. |
| Add Repository | Stub page. |
| Run summary | Functional where data exists: repositories used (from `job.result.selectedRepos`), total duration (from event timestamps), steps completed (count of stages reaching `ok`). "Completed successfully" only when `job.status === "completed"`. |
| Progress timestamps | Functional — derived from SSE `status` event timestamps. |
| Theme toggle | Functional — CSS custom props, `localStorage` key `atc:theme`, system default on first visit. Theme is client-only; no server involvement. |
| Simple/Advanced toggle | Functional — `atc_mode` cookie (read by server for first-byte render) and `?mode=` query override. Toggle writes the cookie and updates the URL via `history.replaceState`. |
| Advanced Options panel | Functional — values serialized into `POST /ask` as described in the Advanced mode section. Not a stub. |

### Stage mapping

The SSE status stream emits free-form messages; the UI maps each to a pipeline stage. Implementation lives in `src/server/ui/stage-mapping.ts` as a pure function with unit tests.

Stages, in order: `job-created`, `repo-selection`, `repository-sync`, `codex-execution`, `synthesis`.

`job-created` is driven by the request lifecycle, not by status messages:
- Initial page state (before any submit): `waiting`.
- When the user clicks Ask and the `POST /ask` fetch is in flight: `running`.
- When `POST /ask` returns `202` with a job ID: `ok` (the job exists now). The first `snapshot` SSE event confirms this state but does not move it.
- When `POST /ask` fails: `failed` with the HTTP error as subtext.

The remaining stages are driven by `status` event text. Heuristic, in priority order:
- `/repo selection/i`, `/selected \d+ repositor/i` → `repo-selection`
- `/repository sync|syncing|up to date|cloning|fetching/i` → `repository-sync`
- Message has the `CODEX_STATUS_PREFIX` or matches `/codex|analyzing/i` → `codex-execution`
- `/synthesis|answer ready|generating answer/i` → `synthesis`
- Default: attach to the most recently active stage.

State transitions for the status-driven stages:
- On first event for a stage, state becomes `running`.
- On a subsequent event for a later stage, previous stages' states become `ok` (unless already failed).
- On job `completed`, all unfinished stages that received at least one event become `ok`; the final stage is `ok`. `job-created` must already be `ok`.
- On job `failed`, the currently running stage becomes `failed`; later stages stay `waiting`. `job-created` stays at its prior state.

## Data flow (unchanged)

Client submits `POST /ask` → receives job with `links.events` → opens `EventSource` on `/jobs/:id/events` → receives `snapshot`, `started`, `status`, `completed`/`failed` events. Client maps events into UI state. No new endpoints for the stubs.

## Step plan

Each step is independently committable: `npm run check` passes, `npm run server` runs, no broken behavior between steps.

### Step 1 — Scaffold Hono + asset pipeline

- Add `hono` and `@hono/node-server` to dependencies.
- Vendor `marked` and `DOMPurify` into `src/server/ui/assets/vendor/` (used in Step 2 but committed now so Step 1 lands with everything its acceptance needs). Option: download and commit the two `.min.js` files directly; no npm dep needed for them since they run only in the browser.
- Configure `tsconfig.json` JSX options.
- Create `src/server/app.ts` with `createApp(legacyHandler)` that builds a Hono app with `HttpBindings` (see "Backwards compatibility during migration" for the concrete shape):
  - `GET /ui/assets/*` — static asset serving (resolves asset root from `import.meta.url`: `/dist/` → `dist/server/ui/assets/`, otherwise `src/server/ui/assets/`).
  - `app.all("*", ...)` catch-all forwards to `legacyHandler(c.env.incoming, c.env.outgoing)`, awaiting the response's `finish`/`close`. Every route not yet owned by Hono — including `GET /` — is served by the legacy handler unchanged.
- Rewire `src/server/main.ts` to serve the Hono app via `@hono/node-server`'s `serve()`. No separate dispatcher. Preserve host/port resolution, startup logging, and graceful-shutdown behavior.
- Add `scripts/copy-ui-assets.mjs`; wire into `postbuild` alongside the existing `ensure-bin-executable` step.
- Create `src/server/ui/assets/` with a placeholder `.gitkeep` and `src/server/ui/assets/vendor/` with the two vendored libraries plus their provenance sidecars.
- Tests: existing `http-server` tests pass unchanged (they can keep hitting the raw handler, since `createApp` accepts it as a parameter). Add one smoke test for `createApp()` asserting (a) static-asset path resolution picks the right root for `src/` vs `dist/`, (b) requests to `/ui/assets/vendor/marked.min.js` return 200 with a `text/javascript` content type, and (c) requests to unknown paths reach the provided legacy handler (use a spy).

Acceptance: `npm run check` passes; `atc-server` runs; `curl http://127.0.0.1:8787/` still returns the old HTML via the catch-all; `curl /health`, `curl /repos`, and `POST /ask` still work; `curl /ui/assets/vendor/marked.min.js` returns the vendored file with a 200 and correct content type.

### Step 2 — New UI in Simple mode, replaces `GET /`

- Add `src/server/ui/pages/app-page.tsx` and components for header/logo/ask-card/drop-zone/file-list/progress-panel/after-the-run/answer-card/empty-state.
- Add `src/server/ui/assets/styles.css` (CSS custom props for light/dark, responsive two-column layout).
- Add `src/server/ui/assets/stage-mapping.js` as the single source of truth. Plain ES module with `// @ts-check`, usable directly by the browser. Ships a `stage-mapping.d.ts` sidecar so server-side `.tsx` components (if any need the type) can import it. Vitest tests import the `.js` file directly — no transpilation of this file.
- Add `src/server/ui/assets/app.js` implementing: SSE subscription, `stage-mapping.js` integration, theme toggle, mode toggle read (Advanced mode rendered in Step 3), drop-zone UI state, submit flow.
- Answer rendering is fully client-side in `app.js`: it imports nothing on the server side. It reads `window.marked` and `window.DOMPurify` (loaded once at page load via `<script>` tags), then calls `marked.parse(text)` → `DOMPurify.sanitize(...)` → `answerEl.innerHTML = ...`. No `src/server/ui/markdown.ts` — the wrapping is a 5-line client helper inside `app.js`.
- Add route `GET /` in `src/server/routes/ui.ts`, rendering `app-page.tsx` in Simple mode. Register it in `app.ts` ahead of the `app.all("*", ...)` catch-all so `/` is now owned by Hono and no longer falls through to the legacy handler.
- Keep the old single-string UI on disk but unreachable via HTTP (the new route shadows it).
- Tests: unit tests for stage-mapping (at least one test per stage plus edge cases); markdown render round-trip on a small sample; snapshot test for `app-page.tsx` in Simple mode.

Acceptance: opening the server in a browser shows the new Simple UI with theme toggle, drop zone stub, progress panel that animates through stages during a real Codex run, and a markdown-rendered answer. **XSS smoke check (mandatory):** manually feed an answer string containing `<script>window.__xssFired=true</script>` and confirm in DevTools that `window.__xssFired` is `undefined` after the answer renders. Record the result in the commit message or PR notes.

### Step 3 — Advanced mode + sidebar

- Add `sidebar.tsx`, `mode-switch.tsx`, `options-panel.tsx`, run-summary rendering inside `after-the-run.tsx`.
- Extend `app.js` with: mode toggle write path, hash-based view routing for sidebar sections, run-summary computation from SSE events, Advanced-only stub views rendered into the main column.
- Extend `styles.css` with sidebar theme and advanced layout.
- Wire the All Repositories view to the existing `/repos` endpoint (reused from current client).
- Stubs rendered via `empty-state.tsx` with the messages specified in the Stub behaviors table.
- Tests: snapshot test for `app-page.tsx` in Advanced mode; stage-mapping tests unchanged; no new backend tests.

Acceptance: Simple/Advanced switch works both directions, persists, and supports `?mode=advanced`. Sidebar nav swaps the main panel without a page reload. All stub pages render their messages. Run summary updates during and after a real run.

### Step 4 — Port API routes to Hono

- Create `src/server/routes/ask.ts`, `repos.ts`, `health.ts`. Each file exports a function `register(app, deps)` that installs its routes.
- Rewrite the SSE handler in `ask.ts` using Hono's streaming API (`stream` helper from `hono/streaming`), preserving the existing event types (`snapshot`, `started`, `status`, `completed`, `failed`), `retry:` directive, 15s keep-alive comment, and terminal-status behavior.
- Preserve every response shape, status code, and header from `http-server.ts`. Explicitly keep `Access-Control-Allow-*` headers and the 413/400/404/410 error shapes.
- Port or rewrite existing tests in `test/server/` to exercise the Hono app directly via `app.fetch(new Request(...))`. Keep test names and intent; update only the harness.
- Delete the previous raw HTTP handler module and the `app.all("*", ...)` transition catch-all in `app.ts`. `createApp()` no longer takes a `legacyHandler` parameter; `main.ts` calls it with no arguments.

Acceptance: `npm run check` passes with the legacy file removed; no behavioral change visible from the outside.

### Step 5 — Cleanup and docs

- Delete the old single-string UI module.
- Remove any remaining transition shims.
- Update `specs/architecture.md`, `specs/http-api.md`, and `README.md` only for anything user-visible that changed (the external HTTP contract should be unchanged, so most likely only architecture.md needs a section on the Hono layering and the new UI structure).
- Final `npm run check`.

Acceptance: the old single-string UI module is gone; docs describe the current shape; one clean commit graph ready for review. Re-run the XSS smoke check from Step 2 against the final build and record the result.

## Testing strategy

- **Stage mapping** — unit tests with at least one example per stage plus edge cases (unknown message, messages mentioning multiple stages, codex prefix detection).
- **Markdown rendering** — since parsing and sanitization run in the browser, tests for this piece use a tiny Node harness that loads the vendored `marked` and `DOMPurify` scripts against a `happy-dom` (or `jsdom`) instance created ad-hoc in the test. Alternative: skip automated tests for the vendored scripts and rely on manual verification of the rendered answer plus a single XSS smoke check (`<script>alert(1)</script>` in the answer string must not produce a `<script>` tag in the DOM). Pragmatic default: go with the manual smoke check; adding a DOM environment just for two assertions isn't worth the test-time complexity. Flag this in the PR body.
- **HTTP contract** — port existing `http-server` tests to Hono in Step 4 without changing their expectations.
- **UI snapshots** — one per mode (Simple, Advanced). Regenerate whenever layout intentionally changes.
- **Manual verification** — each step ends with `npm run server`, browser open, the flows listed under each step's Acceptance.

No jsdom, no Playwright, no new browser test stack.

## Risks and open questions

- **SSE under Hono.** `@hono/node-server` supports streaming, but the exact ergonomics differ from raw `node:http`. Step 4 is the moment to discover any gaps. If the Hono streaming API cannot match the existing keep-alive semantics cleanly, we fall back to escape-hatch raw-`Response`-body handling inside the route. Flagged in advance because this is the most likely source of Step 4 churn.
- **Asset-root detection.** A process running from `dist/` with a co-located source tree could theoretically pick the wrong root. Mitigation: detect based on the compiled `import.meta.url` path containing `/dist/`; tested in the smoke test.
- **Markdown trust boundary.** Answers from Codex are untrusted text. `marked` does NOT sanitize, so the client pipeline is `marked.parse(text) → DOMPurify.sanitize(html) → innerHTML`. DOMPurify is vendored alongside `marked`. A manual XSS smoke check is part of each step's verification; see Testing strategy for why we don't wire an automated DOM test into Vitest.
- **JSX runtime and TypeScript strictness.** If `hono/jsx` types collide with the test-side TS config, Step 1 may need to split `tsconfig.json` further. Noted, not yet decided.

## Verification notes

- 2026-04-27: final implementation verification passed with `npm run check`.
- 2026-04-27: XSS smoke check passed for `<script>window.__xssFired=true</script>` through the browser helper's `marked.parse(...) → DOMPurify.sanitize(...)` wrapper; the rendered HTML did not contain a script tag or `__xssFired`.

## Out-of-scope follow-ups (not part of this spec)

- Other auth providers.
- Persistent job history (file-backed or in-memory list).
- Sync Status endpoint and live view.
- Add Repository / Discover GitHub flows exposed via HTTP.
- `htmx`/`Alpine` later if richer interactivity becomes useful.
