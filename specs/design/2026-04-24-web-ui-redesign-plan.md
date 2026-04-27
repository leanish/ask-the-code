# Web UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing single-string web UI in `src/server/ui/html.ts` with a Hono-based, redesigned UI matching the provided mocks (Simple + Expert modes).

**Architecture:** Hono fronts the HTTP listener via `@hono/node-server`'s `serve()`. During steps 1–3 a catch-all Hono middleware (using official `HttpBindings`) forwards unmigrated paths to the existing `createHttpHandler`. Step 4 ports each route family into Hono and deletes the catch-all. Step 5 deletes `html.ts`. Markdown is rendered client-side using vendored `marked` + `DOMPurify`.

**Tech Stack:** Node ≥24, TypeScript ESM, Vitest, Hono, `@hono/node-server`, vanilla JS (no bundler), CSS custom properties for theming.

**Spec:** `specs/design/2026-04-24-web-ui-redesign.md` (read first).

**Working location:** `/Users/leandro.aguiar/dev/temp/atc-web-ui-redesign` (worktree, branch `web-ui-redesign`).

**Local-only constraint:** no `git push`, no PRs. Commits within the worktree branch are fine and recommended at each task boundary; if the user prefers no commits at all, replace the "commit" step with a `git status` verification.

---

## End-state file structure (after Task 22)

```
src/server/
  main.ts
  args.ts
  app.ts
  routes/
    ask.ts
    repos.ts
    health.ts
    ui.ts
  ui/
    pages/
      app-page.tsx
    components/
      header.tsx
      logo.tsx
      sidebar.tsx
      mode-switch.tsx
      ask-card.tsx
      drop-zone.tsx
      file-list.tsx
      progress-panel.tsx
      after-the-run.tsx
      options-panel.tsx
      answer-card.tsx
      empty-state.tsx
    assets/
      styles.css
      app.js
      stage-mapping.js
      stage-mapping.d.ts
      logo.svg
      vendor/
        marked.min.js
        marked.min.js.provenance.txt
        purify.min.js
        purify.min.js.provenance.txt
scripts/
  copy-ui-assets.mjs
test/
  app-create.test.ts
  stage-mapping.test.ts
  ui-page-snapshot.test.ts
  routes-ask.test.ts        (replaces parts of http-server.test.ts in Task 19/20)
  routes-repos.test.ts
  routes-health.test.ts
```

`src/server/api/http-server.ts` and `src/server/ui/html.ts` are deleted by Tasks 21 and 22 respectively.

---

# Step 1 — Scaffold Hono + asset pipeline

## Task 1: Add Hono dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1.** Add to `package.json` `dependencies`:

```json
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "hono": "^4.6.14"
  }
```

(Insert before `devDependencies`. The package currently has no `dependencies` block; add one.)

- [ ] **Step 2.** Run `npm install`. Expected: `node_modules/hono/` and `node_modules/@hono/node-server/` exist, `package-lock.json` updates.

- [ ] **Step 3.** Verify nothing broke: `npm run typecheck`. Expected: pass.

## Task 2: Configure JSX for Hono

**Files:**
- Modify: `tsconfig.json`
- Modify: `tsconfig.build.json`
- Modify: `tsconfig.test.json`

- [ ] **Step 1.** Add to `compilerOptions` in `tsconfig.json`:

```json
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
```

- [ ] **Step 2.** Mirror these two options into `tsconfig.build.json` and `tsconfig.test.json` (their `compilerOptions` if present, otherwise add a `compilerOptions` block).

- [ ] **Step 3.** `npm run typecheck`. Expected: pass (no `.tsx` files exist yet, so no JSX is exercised — this just locks the option in for later tasks).

## Task 3: Vendor `marked` and `DOMPurify` with provenance

**Files:**
- Create: `src/server/ui/assets/vendor/marked.min.js`
- Create: `src/server/ui/assets/vendor/marked.min.js.provenance.txt`
- Create: `src/server/ui/assets/vendor/purify.min.js`
- Create: `src/server/ui/assets/vendor/purify.min.js.provenance.txt`

- [ ] **Step 1.** Download `marked.min.js`:

```bash
mkdir -p src/server/ui/assets/vendor
curl -fsSL -o src/server/ui/assets/vendor/marked.min.js \
  https://cdn.jsdelivr.net/npm/marked@14.1.4/marked.min.js
```

(jsDelivr serves the npm release artifact; the URL is recorded in the provenance sidecar so we know the upstream pin even though we no longer fetch from there.)

- [ ] **Step 2.** Compute SHA-256 and write provenance:

```bash
shasum -a 256 src/server/ui/assets/vendor/marked.min.js
```

Use the resulting hash to populate `src/server/ui/assets/vendor/marked.min.js.provenance.txt`:

```text
library: marked
version: 14.1.4
source: https://cdn.jsdelivr.net/npm/marked@14.1.4/marked.min.js
sha256: <PASTE_HASH_HERE>
license: MIT
fetched: 2026-04-25
```

- [ ] **Step 3.** Download `purify.min.js`:

```bash
curl -fsSL -o src/server/ui/assets/vendor/purify.min.js \
  https://cdn.jsdelivr.net/npm/dompurify@3.2.1/dist/purify.min.js
```

- [ ] **Step 4.** Compute SHA-256 and write `purify.min.js.provenance.txt`:

```text
library: DOMPurify
version: 3.2.1
source: https://cdn.jsdelivr.net/npm/dompurify@3.2.1/dist/purify.min.js
sha256: <PASTE_HASH_HERE>
license: Apache-2.0 OR MPL-2.0
fetched: 2026-04-25
```

- [ ] **Step 5.** Verify both files are non-empty JavaScript:

```bash
head -1 src/server/ui/assets/vendor/marked.min.js | head -c 200
head -1 src/server/ui/assets/vendor/purify.min.js | head -c 200
```

Expected: both output minified JS (lines starting with `!function` or `(function` or similar IIFE markers).

## Task 4: Asset-copy build script

**Files:**
- Create: `scripts/copy-ui-assets.mjs`
- Modify: `package.json` (`scripts.postbuild`)

- [ ] **Step 1.** Create `scripts/copy-ui-assets.mjs`:

```javascript
#!/usr/bin/env node
import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const source = resolve(repoRoot, "src/server/ui/assets");
const target = resolve(repoRoot, "dist/server/ui/assets");

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
process.stdout.write(`copied ui assets to ${target}\n`);
```

- [ ] **Step 2.** Update `package.json` `scripts.postbuild`:

```json
"postbuild": "node ./scripts/ensure-bin-executable.mjs && node ./scripts/copy-ui-assets.mjs"
```

- [ ] **Step 3.** Run `npm run build`. Expected: build succeeds, `dist/server/ui/assets/vendor/marked.min.js` exists.

```bash
ls -la dist/server/ui/assets/vendor/
```

## Task 5: Implement `createApp` with HttpBindings catch-all

**Files:**
- Create: `src/server/app.ts`

`createHttpHandler` from `src/server/api/http-server.ts` already exists and is callable. We reuse it as the catch-all handler.

- [ ] **Step 1.** Create `src/server/app.ts`:

```typescript
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import type { IncomingMessage, ServerResponse } from "node:http";

export type LegacyHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

export type AppEnv = { Bindings: HttpBindings };

export interface CreateAppOptions {
  legacyHandler: LegacyHandler;
  assetRoot?: string;
}

export function resolveAssetRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "ui/assets"),
    resolve(here, "../ui/assets")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Cannot locate ui/assets relative to ${here}`);
}

export function createApp(options: CreateAppOptions): Hono<AppEnv> {
  const { legacyHandler } = options;
  const assetRoot = options.assetRoot ?? resolveAssetRoot();

  const app = new Hono<AppEnv>();

  app.use(
    "/ui/assets/*",
    serveStatic({
      root: assetRoot,
      rewriteRequestPath: path => path.replace(/^\/ui\/assets\//, "/")
    })
  );

  app.all("*", async c => {
    const incoming = c.env.incoming;
    const outgoing = c.env.outgoing;

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const onFinish = () => {
        cleanup();
        resolvePromise();
      };
      const onClose = () => {
        cleanup();
        resolvePromise();
      };
      const onError = (error: Error) => {
        cleanup();
        rejectPromise(error);
      };
      function cleanup() {
        outgoing.off("finish", onFinish);
        outgoing.off("close", onClose);
        outgoing.off("error", onError);
      }

      outgoing.once("finish", onFinish);
      outgoing.once("close", onClose);
      outgoing.once("error", onError);

      try {
        const result = legacyHandler(incoming, outgoing);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(rejectPromise);
        }
      } catch (error) {
        cleanup();
        rejectPromise(error as Error);
      }
    });

    return c.body(null);
  });

  return app;
}
```

- [ ] **Step 2.** `npm run typecheck`. Expected: pass.

## Task 6: Rewire `startHttpServer` to use Hono via `@hono/node-server`

**Files:**
- Modify: `src/server/api/http-server.ts` (replace `http.createServer(handler)` block with Hono-based `serve()`)

The function's external API stays the same; only the internal listener changes.

- [ ] **Step 1.** At the top of `src/server/api/http-server.ts`, add the imports:

```typescript
import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "../app.ts";
```

- [ ] **Step 2.** In `startHttpServer`, replace this block:

```typescript
  const handler = createHttpHandler({
    bodyLimitBytes: resolvedBodyLimitBytes,
    env,
    jobManager: resolvedJobManager,
    loadConfigFn
  });
  const server = http.createServer((request, response) => {
    void handler(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(resolvedPort, resolvedHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
```

with:

```typescript
  const handler = createHttpHandler({
    bodyLimitBytes: resolvedBodyLimitBytes,
    env,
    jobManager: resolvedJobManager,
    loadConfigFn
  });
  const app = createApp({ legacyHandler: (request, response) => { void handler(request, response); } });

  const server = await new Promise<http.Server>((resolvePromise, rejectPromise) => {
    const created = serve(
      {
        fetch: app.fetch,
        hostname: resolvedHost,
        port: resolvedPort
      },
      info => {
        resolvePromise(info as unknown as http.Server);
      }
    );
    (created as unknown as ServerType).on?.("error", rejectPromise);
  });
```

(`serve()` from `@hono/node-server` returns the underlying `http.Server`. We keep the existing `server` variable and `formatServerUrl` keep working unchanged because `address()` is still available.)

- [ ] **Step 3.** `npm run typecheck`. Expected: pass.

- [ ] **Step 4.** `npm test -- --run http-server`. Expected: existing tests still pass — they exercise the catch-all path that forwards to the legacy handler.

- [ ] **Step 5.** Manual smoke: start the server with `npm run server`, then in another shell:

```bash
curl -s -H "Accept: text/html" http://127.0.0.1:8787/ | head -5
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/repos
```

Expected: HTML preamble for `/`, JSON `{"status":"ok",...}` for `/health`, repos JSON for `/repos`. Stop the server.

## Task 7: Smoke test for `createApp`

**Files:**
- Create: `test/app-create.test.ts`

- [ ] **Step 1.** Write the test:

```typescript
import { describe, expect, it, vi } from "vitest";

import { createApp, resolveAssetRoot } from "../src/server/app.ts";
import { existsSync } from "node:fs";

describe("createApp", () => {
  it("resolves the asset root to a real directory", () => {
    const root = resolveAssetRoot();
    expect(existsSync(root)).toBe(true);
  });

  it("serves vendored marked.min.js under /ui/assets", async () => {
    const legacyHandler = vi.fn();
    const app = createApp({ legacyHandler });
    const response = await app.fetch(new Request("http://localhost/ui/assets/vendor/marked.min.js"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toMatch(/javascript/);
    expect(legacyHandler).not.toHaveBeenCalled();
  });

  it("forwards unknown paths to the legacy handler", async () => {
    const legacyHandler = vi.fn((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    const app = createApp({ legacyHandler });
    const response = await app.fetch(new Request("http://localhost/some/other/path"));

    expect(legacyHandler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(204);
  });
});
```

- [ ] **Step 2.** Run the test:

```bash
npm test -- --run app-create
```

Expected: 3 passing tests.

- [ ] **Step 3.** Full check:

```bash
npm run check
```

Expected: typecheck, all tests, build all pass.

- [ ] **Step 4.** (Optional, recommended) commit:

```bash
git add -A
git commit -m "step 1: scaffold hono + asset pipeline"
```

---

# Step 2 — New UI in Simple mode

## Task 8: Add `stage-mapping.js` with TDD

**Files:**
- Create: `src/server/ui/assets/stage-mapping.js`
- Create: `src/server/ui/assets/stage-mapping.d.ts`
- Create: `test/stage-mapping.test.ts`

- [ ] **Step 1.** Write the failing test in `test/stage-mapping.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { mapStatusToStage, STAGE_ORDER } from "../src/server/ui/assets/stage-mapping.js";

describe("mapStatusToStage", () => {
  it("orders the five stages", () => {
    expect(STAGE_ORDER).toEqual([
      "job-created",
      "repo-selection",
      "repository-sync",
      "codex-execution",
      "synthesis"
    ]);
  });

  it("maps repo selection messages", () => {
    expect(mapStatusToStage("Selecting repos via cascade...")).toBe("repo-selection");
    expect(mapStatusToStage("Selected 3 repositories.")).toBe("repo-selection");
  });

  it("maps repository sync messages", () => {
    expect(mapStatusToStage("Syncing repos...")).toBe("repository-sync");
    expect(mapStatusToStage("Up to date.")).toBe("repository-sync");
    expect(mapStatusToStage("Cloning repository...")).toBe("repository-sync");
  });

  it("maps codex execution including the codex status prefix", () => {
    expect(mapStatusToStage("[codex] tokens used: 1234")).toBe("codex-execution");
    expect(mapStatusToStage("Analyzing code and generating answer...")).toBe("codex-execution");
  });

  it("maps synthesis messages", () => {
    expect(mapStatusToStage("Generating answer...")).toBe("synthesis");
    expect(mapStatusToStage("Answer ready.")).toBe("synthesis");
    expect(mapStatusToStage("Synthesis complete")).toBe("synthesis");
  });

  it("returns null for unknown text so the caller keeps the previous stage", () => {
    expect(mapStatusToStage("Unrecognized status line")).toBeNull();
  });
});
```

- [ ] **Step 2.** Run the test:

```bash
npm test -- --run stage-mapping
```

Expected: FAIL (module not found).

- [ ] **Step 3.** Implement `src/server/ui/assets/stage-mapping.js`:

```javascript
// @ts-check

export const STAGE_ORDER = /** @type {const} */ ([
  "job-created",
  "repo-selection",
  "repository-sync",
  "codex-execution",
  "synthesis"
]);

const CODEX_STATUS_PREFIX = "[codex]";

/**
 * Map a free-form status message to a pipeline stage, or null if the message
 * does not move the pipeline forward.
 *
 * @param {string} message
 * @returns {("repo-selection" | "repository-sync" | "codex-execution" | "synthesis" | null)}
 */
export function mapStatusToStage(message) {
  if (typeof message !== "string") {
    return null;
  }

  if (/synthesis|answer ready|generating answer/i.test(message)) {
    return "synthesis";
  }

  if (message.startsWith(CODEX_STATUS_PREFIX) || /codex|analyzing/i.test(message)) {
    return "codex-execution";
  }

  if (/repository sync|syncing|up to date|cloning|fetching/i.test(message)) {
    return "repository-sync";
  }

  if (/repo selection|selecting repos|selected \d+ repositor/i.test(message)) {
    return "repo-selection";
  }

  return null;
}
```

- [ ] **Step 4.** Add the type sidecar `src/server/ui/assets/stage-mapping.d.ts`:

```typescript
export type Stage =
  | "job-created"
  | "repo-selection"
  | "repository-sync"
  | "codex-execution"
  | "synthesis";

export const STAGE_ORDER: readonly Stage[];

export function mapStatusToStage(
  message: string
): "repo-selection" | "repository-sync" | "codex-execution" | "synthesis" | null;
```

- [ ] **Step 5.** Re-run the test:

```bash
npm test -- --run stage-mapping
```

Expected: all 6 passing.

- [ ] **Step 6.** Verify Vitest can import a `.js` file from `assets/`. If `tsconfig.test.json` has `"allowJs": false`, set `"allowJs": true` and `"checkJs": true` in that file.

## Task 9: Add `styles.css` with light/dark theme

**Files:**
- Create: `src/server/ui/assets/styles.css`

- [ ] **Step 1.** Create the file with the full content:

```css
:root {
  color-scheme: light dark;
  --bg: #f7f8fa;
  --panel: #ffffff;
  --panel-border: #e3e6eb;
  --text: #1f2328;
  --text-muted: #6a737d;
  --text-subtle: #8b95a0;
  --accent: #0b5fff;
  --accent-text: #ffffff;
  --success: #1f883d;
  --warning: #bf8700;
  --error: #cf222e;
  --code-bg: #f0f2f5;
  --shadow: 0 1px 2px rgba(15,17,23,0.04), 0 1px 3px rgba(15,17,23,0.06);
  --radius: 12px;
  --radius-sm: 6px;
  --gap: 1rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
:root[data-theme="dark"] {
  --bg: #0e1116;
  --panel: #161b22;
  --panel-border: #30363d;
  --text: #e6edf3;
  --text-muted: #9ba6b1;
  --text-subtle: #7d8590;
  --accent: #2f81f7;
  --code-bg: #1c2128;
  --success: #3fb950;
  --warning: #d29922;
  --error: #f85149;
  --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.6);
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  font-size: 14px;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.app-shell { display: grid; grid-template-columns: 1fr; min-height: 100vh; }
.app-shell.expert { grid-template-columns: 240px 1fr; }

.sidebar {
  background: #0e1116;
  color: #e6edf3;
  padding: 1rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border-right: 1px solid #1c2128;
}
.sidebar h1 { font-size: 1rem; }
.sidebar-section { display: flex; flex-direction: column; gap: 0.25rem; }
.sidebar-section-title {
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8b95a0;
  padding: 0 0.5rem;
}
.sidebar-link {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  border-radius: var(--radius-sm);
  color: #c9d1d9; cursor: pointer;
}
.sidebar-link:hover { background: #1c2128; }
.sidebar-link[aria-current="page"] { background: #1f6feb33; color: #fff; }
.sidebar-badge {
  background: #21262d; color: #8b95a0; padding: 0 0.4rem; border-radius: 999px; font-size: 0.7rem;
}
.sidebar-footer { color: #6a737d; font-size: 0.7rem; padding: 0 0.5rem; margin-top: auto; }

.main-area { padding: 1.5rem clamp(1rem, 4vw, 2.5rem); display: grid; gap: var(--gap); grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); align-content: start; }

.header {
  grid-column: 1 / -1;
  display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.5rem;
}
.brand { display: flex; align-items: center; gap: 0.75rem; }
.brand-text strong { display: block; font-size: 1rem; }
.brand-text small { color: var(--text-muted); }
.header-actions { display: flex; align-items: center; gap: 0.5rem; }
.icon-button, .button {
  background: var(--panel); color: var(--text); border: 1px solid var(--panel-border);
  border-radius: var(--radius-sm); padding: 0.4rem 0.75rem; cursor: pointer; font: inherit;
}
.button.primary { background: var(--accent); color: var(--accent-text); border-color: transparent; }
.button.primary:disabled { opacity: 0.6; cursor: not-allowed; }

.mode-switch { grid-column: 1 / -1; display: inline-flex; gap: 0.25rem; padding: 0.25rem; background: var(--panel); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); width: fit-content; margin-bottom: 0.25rem; }
.mode-switch button { background: transparent; border: 0; padding: 0.35rem 0.85rem; border-radius: 4px; color: var(--text-muted); cursor: pointer; }
.mode-switch button[aria-pressed="true"] { background: var(--accent); color: var(--accent-text); }

.card { background: var(--panel); border: 1px solid var(--panel-border); border-radius: var(--radius); padding: 1.25rem; box-shadow: var(--shadow); }
.card h2 { font-size: 1rem; margin-bottom: 0.75rem; }

.ask-card textarea { width: 100%; min-height: 7rem; padding: 0.75rem; border: 1px solid var(--panel-border); border-radius: var(--radius-sm); background: var(--panel); color: var(--text); font: inherit; resize: vertical; }
.ask-card textarea::placeholder { color: var(--text-subtle); }
.ask-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 0.75rem; gap: 0.75rem; flex-wrap: wrap; }
.ask-actions .button.primary { display: inline-flex; align-items: center; gap: 0.4rem; }
.attach-banner { font-size: 0.78rem; color: var(--text-muted); margin-top: 0.5rem; }

.drop-zone { margin-top: 0.75rem; border: 1px dashed var(--panel-border); border-radius: var(--radius-sm); padding: 1rem; text-align: center; color: var(--text-muted); cursor: pointer; }
.drop-zone.dragover { border-color: var(--accent); color: var(--accent); }
.file-list { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.5rem; }
.file-row { display: grid; grid-template-columns: 32px 1fr auto auto; align-items: center; gap: 0.6rem; padding: 0.5rem 0.75rem; border: 1px solid var(--panel-border); border-radius: var(--radius-sm); }
.file-row .name { font-weight: 500; }
.file-row .meta { color: var(--text-muted); font-size: 0.8rem; }
.file-row .ok { color: var(--success); font-size: 0.85rem; }
.file-row button.remove { background: transparent; border: 0; color: var(--text-muted); cursor: pointer; }

.progress-list { display: flex; flex-direction: column; gap: 0.5rem; }
.progress-item { display: grid; grid-template-columns: 24px 1fr auto; gap: 0.5rem; align-items: start; padding: 0.5rem 0; border-bottom: 1px solid var(--panel-border); }
.progress-item:last-child { border-bottom: 0; }
.progress-marker { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--panel-border); margin-top: 0.15rem; background: var(--panel); }
.progress-item[data-state="running"] .progress-marker { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(47,129,247,0.15); }
.progress-item[data-state="ok"] .progress-marker { background: var(--success); border-color: var(--success); }
.progress-item[data-state="failed"] .progress-marker { background: var(--error); border-color: var(--error); }
.progress-title { font-weight: 500; }
.progress-sub { color: var(--text-muted); font-size: 0.82rem; }
.progress-time { color: var(--text-subtle); font-size: 0.78rem; font-variant-numeric: tabular-nums; }

.full-log-button { width: 100%; margin-top: 0.5rem; }
.full-log { display: none; max-height: 16rem; overflow-y: auto; padding: 0.75rem; background: var(--code-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; font-size: 0.78rem; white-space: pre-wrap; }
.full-log.visible { display: block; }

.after-the-run .empty { color: var(--text-muted); font-size: 0.85rem; }
.repo-row { display: grid; grid-template-columns: 24px 1fr; gap: 0.5rem; padding: 0.5rem 0; }
.repo-row .repo-path { color: var(--text-muted); font-size: 0.8rem; }

.run-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-top: 0.5rem; }
.run-summary > div strong { display: block; font-size: 1.1rem; }
.run-summary > div small { color: var(--text-muted); font-size: 0.78rem; }
.run-summary-success { margin-top: 0.5rem; color: var(--success); font-weight: 500; }

.answer-card .answer { padding: 0.75rem 0; }
.answer-card .answer h1, .answer-card .answer h2, .answer-card .answer h3 { margin: 0.75rem 0 0.4rem; }
.answer-card .answer ol, .answer-card .answer ul { padding-left: 1.5rem; margin: 0.4rem 0; }
.answer-card .answer p { margin: 0.4rem 0; }
.answer-card .answer code { background: var(--code-bg); padding: 0.05rem 0.35rem; border-radius: 4px; font-size: 0.85em; }
.answer-card .answer pre { background: var(--code-bg); padding: 0.75rem; border-radius: var(--radius-sm); overflow-x: auto; }
.answer-actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; justify-content: space-between; }
.toast { position: fixed; bottom: 1rem; right: 1rem; background: var(--panel); border: 1px solid var(--panel-border); padding: 0.6rem 0.9rem; border-radius: var(--radius-sm); box-shadow: var(--shadow); }

.options-list { display: flex; flex-direction: column; gap: 0.6rem; }
.options-list label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; color: var(--text-muted); }
.options-list select, .options-list input[type="text"] { background: var(--panel); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); padding: 0.4rem 0.6rem; color: var(--text); font: inherit; }
.toggle-row { display: flex; justify-content: space-between; align-items: center; }

.empty-state { padding: 2rem 1rem; text-align: center; color: var(--text-muted); }

@media (max-width: 980px) {
  .main-area { grid-template-columns: 1fr; }
  .app-shell.expert { grid-template-columns: 1fr; }
  .sidebar { display: none; }
}
```

- [ ] **Step 2.** No tests (pure styling). The file is consumed in the next tasks.

## Task 10: Add the rainbow ATC logo

**Files:**
- Create: `src/server/ui/assets/logo.svg`

- [ ] **Step 1.** Create `src/server/ui/assets/logo.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" role="img" aria-label="ATC">
  <defs>
    <style>
      .atc-text { font: 700 56px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; letter-spacing: -2px; }
    </style>
    <linearGradient id="atc-stripes" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1f6feb"/>
      <stop offset="20%" stop-color="#2ea043"/>
      <stop offset="40%" stop-color="#bf8700"/>
      <stop offset="60%" stop-color="#cf222e"/>
      <stop offset="80%" stop-color="#8250df"/>
      <stop offset="100%" stop-color="#fb8500"/>
    </linearGradient>
  </defs>
  <text x="0" y="50" class="atc-text" fill="url(#atc-stripes)">ATC</text>
</svg>
```

## Task 11: Add JSX components for the Simple-mode shell

**Files:**
- Create: `src/server/ui/components/logo.tsx`
- Create: `src/server/ui/components/header.tsx`
- Create: `src/server/ui/components/ask-card.tsx`
- Create: `src/server/ui/components/drop-zone.tsx`
- Create: `src/server/ui/components/file-list.tsx`
- Create: `src/server/ui/components/progress-panel.tsx`
- Create: `src/server/ui/components/after-the-run.tsx`
- Create: `src/server/ui/components/answer-card.tsx`
- Create: `src/server/ui/components/empty-state.tsx`

- [ ] **Step 1.** `src/server/ui/components/logo.tsx`:

```tsx
export function Logo() {
  return <img class="logo" src="/ui/assets/logo.svg" alt="ATC" width="48" height="24" />;
}
```

- [ ] **Step 2.** `src/server/ui/components/header.tsx`:

```tsx
import { Logo } from "./logo.tsx";

export function Header() {
  return (
    <header class="header">
      <div class="brand">
        <Logo />
        <div class="brand-text">
          <strong>ask-the-code (ATC)</strong>
          <small>Repo-aware · Codex</small>
        </div>
      </div>
      <div class="header-actions">
        <button id="theme-toggle" class="icon-button" type="button" aria-label="Toggle theme">☀</button>
        <button id="google-signin" class="button" type="button">Sign in with Google</button>
      </div>
    </header>
  );
}
```

- [ ] **Step 3.** `src/server/ui/components/empty-state.tsx`:

```tsx
import type { Child } from "hono/jsx";

export function EmptyState({ title, body }: { title: string; body?: Child }) {
  return (
    <div class="empty-state">
      <strong>{title}</strong>
      {body ? <div>{body}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4.** `src/server/ui/components/drop-zone.tsx`:

```tsx
export function DropZone() {
  return (
    <div id="drop-zone" class="drop-zone">
      Drag &amp; drop files here, or click to browse
      <div style="font-size:0.78rem;margin-top:0.25rem">PDF, PNG, JPG, MP4, MOV, TXT · Max 100 MB each</div>
      <input id="file-input" type="file" multiple hidden />
    </div>
  );
}
```

- [ ] **Step 5.** `src/server/ui/components/file-list.tsx`:

```tsx
export function FileList() {
  return (
    <>
      <div id="file-list" class="file-list" aria-live="polite"></div>
      <div id="attach-banner" class="attach-banner" hidden>
        Attachments are preview-only in this build.
      </div>
    </>
  );
}
```

- [ ] **Step 6.** `src/server/ui/components/ask-card.tsx`:

```tsx
import { DropZone } from "./drop-zone.tsx";
import { FileList } from "./file-list.tsx";

export function AskCard() {
  return (
    <section class="card ask-card" aria-labelledby="ask-heading">
      <h2 id="ask-heading">Ask a question</h2>
      <textarea id="question" rows={6} placeholder="Ask a question about your code..."></textarea>
      <div class="ask-actions">
        <button id="attach-button" class="button" type="button">📎 Attach files</button>
        <button id="ask-button" class="button primary" type="button" data-default-label="▶ Ask (Run Job)">▶ Ask (Run Job)</button>
      </div>
      <DropZone />
      <FileList />
    </section>
  );
}
```

- [ ] **Step 7.** `src/server/ui/components/progress-panel.tsx`:

```tsx
const STAGES: Array<{ id: string; title: string; waitingSubtitle: string }> = [
  { id: "job-created", title: "Job Created", waitingSubtitle: "Your job will be created when you run it." },
  { id: "repo-selection", title: "Repo Selection", waitingSubtitle: "Waiting" },
  { id: "repository-sync", title: "Repository Sync", waitingSubtitle: "Waiting" },
  { id: "codex-execution", title: "Codex Execution", waitingSubtitle: "Waiting" },
  { id: "synthesis", title: "Synthesis", waitingSubtitle: "Waiting" }
];

export function ProgressPanel() {
  return (
    <section class="card progress-card" aria-labelledby="progress-heading">
      <h2 id="progress-heading">Progress</h2>
      <div id="progress-list" class="progress-list">
        {STAGES.map(stage => (
          <div class="progress-item" data-stage={stage.id} data-state="waiting">
            <div class="progress-marker" aria-hidden="true"></div>
            <div>
              <div class="progress-title">{stage.title}</div>
              <div class="progress-sub">{stage.waitingSubtitle}</div>
            </div>
            <div class="progress-time"></div>
          </div>
        ))}
      </div>
      <button id="toggle-full-log" class="button full-log-button" type="button">View Full Log</button>
      <pre id="full-log" class="full-log"></pre>
    </section>
  );
}
```

- [ ] **Step 8.** `src/server/ui/components/after-the-run.tsx`:

```tsx
export function AfterTheRun({ expert = false }: { expert?: boolean }) {
  return (
    <section class="card after-the-run" aria-labelledby="after-heading">
      <h2 id="after-heading">After the run</h2>
      <div id="after-empty">
        <p class="empty">We'll show you which repositories were used and a summary of what happened.</p>
      </div>
      <div id="after-content" hidden>
        <div id="after-repos"></div>
        {expert ? (
          <div class="run-summary" id="run-summary">
            <div><strong id="summary-repo-count">0</strong><small>Repositories used</small></div>
            <div><strong id="summary-duration">—</strong><small>Total duration</small></div>
            <div><strong id="summary-steps">0</strong><small>Steps completed</small></div>
          </div>
        ) : null}
        <div id="run-summary-success" class="run-summary-success" hidden>✓ Completed successfully</div>
      </div>
    </section>
  );
}
```

- [ ] **Step 9.** `src/server/ui/components/answer-card.tsx`:

```tsx
export function AnswerCard() {
  return (
    <section id="answer-card" class="card answer-card" aria-labelledby="answer-heading" hidden>
      <h2 id="answer-heading">Answer</h2>
      <div id="answer" class="answer"></div>
      <div class="answer-actions">
        <button id="copy-answer" class="button" type="button">📋 Copy Answer</button>
        <button id="download-answer" class="button" type="button">⬇ Download Markdown</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 10.** `npm run typecheck`. Expected: pass.

## Task 12: Add `app-page.tsx` (Simple mode)

**Files:**
- Create: `src/server/ui/pages/app-page.tsx`

- [ ] **Step 1.** Create the page:

```tsx
import { html } from "hono/html";

import { AfterTheRun } from "../components/after-the-run.tsx";
import { AnswerCard } from "../components/answer-card.tsx";
import { AskCard } from "../components/ask-card.tsx";
import { Header } from "../components/header.tsx";
import { ProgressPanel } from "../components/progress-panel.tsx";

export type AppMode = "simple" | "expert";

export interface AppPageProps {
  mode: AppMode;
}

export function AppPage({ mode }: AppPageProps) {
  return html`<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ask-the-code</title>
  <link rel="stylesheet" href="/ui/assets/styles.css" />
  <link rel="icon" type="image/svg+xml" href="/ui/assets/logo.svg" />
  <script src="/ui/assets/vendor/marked.min.js" defer></script>
  <script src="/ui/assets/vendor/purify.min.js" defer></script>
  <script type="module" src="/ui/assets/app.js" defer></script>
</head>
<body data-mode="${mode}">
  <div class="app-shell ${mode}">
    <main class="main-area">
      ${(<>
        <Header />
        <AskCard />
        <ProgressPanel />
        <AnswerCard />
        <AfterTheRun />
      </>)}
    </main>
  </div>
</body>
</html>`;
}
```

- [ ] **Step 2.** `npm run typecheck`. Expected: pass.

## Task 13: Add `routes/ui.ts` and wire it into `app.ts`

**Files:**
- Create: `src/server/routes/ui.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1.** Create `src/server/routes/ui.ts`:

```typescript
import type { Hono } from "hono";

import type { AppEnv } from "../app.ts";
import { AppPage, type AppMode } from "../ui/pages/app-page.tsx";

const COOKIE_NAME = "atc_mode";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function registerUiRoutes(app: Hono<AppEnv>): void {
  app.get("/", c => {
    const queryMode = parseMode(c.req.query("mode"));
    const cookieMode = parseMode(readCookie(c.req.header("cookie"), COOKIE_NAME));
    const mode: AppMode = queryMode ?? cookieMode ?? "simple";

    if (queryMode) {
      c.header("Set-Cookie", buildCookie(COOKIE_NAME, queryMode, COOKIE_MAX_AGE));
    }

    return c.html(AppPage({ mode }));
  });
}

function parseMode(value: string | undefined | null): AppMode | null {
  if (value === "simple" || value === "expert") {
    return value;
  }
  return null;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("=") ?? "");
    }
  }
  return undefined;
}

function buildCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}
```

- [ ] **Step 2.** Modify `src/server/app.ts` to call `registerUiRoutes` before the catch-all. Insert the import:

```typescript
import { registerUiRoutes } from "./routes/ui.ts";
```

And inside `createApp`, after `app.use("/ui/assets/*", ...)` and before `app.all("*", ...)`, add:

```typescript
  registerUiRoutes(app);
```

- [ ] **Step 3.** `npm run typecheck`. Expected: pass.

## Task 14: Add `app.js` with SSE, drop zone, theme, mode-cookie

**Files:**
- Create: `src/server/ui/assets/app.js`

This file is non-trivial (~250 lines). It is purely client-side.

- [ ] **Step 1.** Create `src/server/ui/assets/app.js`:

```javascript
// @ts-check
import { mapStatusToStage, STAGE_ORDER } from "./stage-mapping.js";

const COOKIE_NAME = "atc_mode";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const THEME_STORAGE_KEY = "atc:theme";

const state = {
  mode: document.body.dataset.mode === "expert" ? "expert" : "simple",
  attachments: [],
  jobId: null,
  jobStartTimestamp: null,
  jobEndTimestamp: null,
  events: [],
  stages: new Map(STAGE_ORDER.map(id => [id, { state: "waiting", startedAt: null }])),
  currentAnswer: null
};

function $(id) { return document.getElementById(id); }

function init() {
  initTheme();
  initSubmit();
  initDropZone();
  initToggles();
  initStubs();
  initThemeToggle();
}

function initTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = stored ?? (prefersDark ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  const button = $("theme-toggle");
  if (button) button.textContent = theme === "dark" ? "🌙" : "☀";
}

function initThemeToggle() {
  const button = $("theme-toggle");
  if (!button) return;
  button.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_STORAGE_KEY, next);
    button.textContent = next === "dark" ? "🌙" : "☀";
  });
}

function initStubs() {
  const google = $("google-signin");
  if (google) google.addEventListener("click", () => showToast("Google sign-in isn't wired up yet."));
}

function initToggles() {
  const toggleLog = $("toggle-full-log");
  const log = $("full-log");
  if (toggleLog && log) {
    toggleLog.addEventListener("click", () => {
      log.classList.toggle("visible");
      toggleLog.textContent = log.classList.contains("visible") ? "Hide Full Log" : "View Full Log";
    });
  }
  const copyAnswer = $("copy-answer");
  if (copyAnswer) {
    copyAnswer.addEventListener("click", async () => {
      if (!state.currentAnswer) return;
      try { await navigator.clipboard.writeText(state.currentAnswer); showToast("Answer copied"); }
      catch { showToast("Copy failed"); }
    });
  }
  const downloadAnswer = $("download-answer");
  if (downloadAnswer) {
    downloadAnswer.addEventListener("click", () => {
      if (!state.currentAnswer) return;
      const blob = new Blob([state.currentAnswer], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "answer.md"; a.click();
      URL.revokeObjectURL(url);
    });
  }
}

function initDropZone() {
  const zone = $("drop-zone");
  const input = $("file-input");
  const attach = $("attach-button");
  if (!zone || !input || !attach) return;

  attach.addEventListener("click", e => { e.preventDefault(); input.click(); });
  zone.addEventListener("click", () => input.click());

  ["dragenter","dragover"].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave","drop"].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove("dragover"); }));
  zone.addEventListener("drop", e => addFiles(e.dataTransfer ? Array.from(e.dataTransfer.files) : []));
  input.addEventListener("change", () => addFiles(Array.from(input.files ?? [])));
}

function addFiles(files) {
  for (const file of files) {
    state.attachments.push({ name: file.name, type: file.type, size: file.size });
  }
  renderFileList();
}

function renderFileList() {
  const list = $("file-list");
  const banner = $("attach-banner");
  if (!list) return;
  list.innerHTML = "";
  for (const [index, file] of state.attachments.entries()) {
    const row = document.createElement("div");
    row.className = "file-row";
    row.innerHTML = `
      <span aria-hidden="true">📄</span>
      <div><div class="name"></div><div class="meta"></div></div>
      <span class="ok">✓ Uploaded</span>
      <button class="remove" type="button" aria-label="Remove">✕</button>`;
    row.querySelector(".name").textContent = file.name;
    row.querySelector(".meta").textContent = `${file.type || "file"} · ${formatSize(file.size)}`;
    row.querySelector("button.remove").addEventListener("click", () => {
      state.attachments.splice(index, 1);
      renderFileList();
    });
    list.appendChild(row);
  }
  if (banner) banner.hidden = state.attachments.length === 0;
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initSubmit() {
  const button = $("ask-button");
  if (!button) return;
  button.addEventListener("click", () => void submitAsk());
}

async function submitAsk() {
  const textarea = /** @type {HTMLTextAreaElement | null} */ ($("question"));
  if (!textarea || !textarea.value.trim()) return;

  resetRun();
  setStageState("job-created", "running", "Submitting...");
  state.jobStartTimestamp = Date.now();

  const payload = buildPayload(textarea.value.trim());
  const button = $("ask-button");
  if (button) { button.disabled = true; button.textContent = "Asking..."; }

  try {
    const response = await fetch("/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    state.jobId = data.id;
    setStageState("job-created", "ok", new Date().toLocaleTimeString());
    appendLog(`Job created: ${data.id}`);
    connectSse(data.links.events);
  } catch (error) {
    setStageState("job-created", "failed", error.message);
    if (button) { button.disabled = false; button.textContent = button.dataset.defaultLabel ?? "Ask"; }
  }
}

function buildPayload(question) {
  const payload = { question };
  // Expert-mode-only fields are wired in Task 17.
  return payload;
}

function connectSse(url) {
  const source = new EventSource(url);
  source.addEventListener("status", evt => handleStatus(JSON.parse(evt.data)));
  source.addEventListener("snapshot", evt => handleSnapshot(JSON.parse(evt.data)));
  source.addEventListener("completed", () => { void source.close(); });
  source.addEventListener("failed", evt => {
    const data = parseSafe(evt.data);
    failRun(data?.message ?? "Job failed.");
    source.close();
  });
  source.addEventListener("error", () => { /* keep-alive on transient errors */ });
}

function handleStatus(event) {
  if (!event || typeof event.message !== "string") return;
  appendLog(event.message);
  state.events.push(event);
  const stage = mapStatusToStage(event.message);
  if (!stage) return;
  for (const earlier of stagesUpTo(stage)) {
    const existing = state.stages.get(earlier);
    if (existing && existing.state !== "ok" && existing.state !== "failed") {
      setStageState(earlier, "ok", existing.startedAt ? formatTime(existing.startedAt) : new Date().toLocaleTimeString());
    }
  }
  setStageState(stage, "running", new Date().toLocaleTimeString(), event.message);
}

function handleSnapshot(job) {
  if (!job) return;
  if (job.status === "completed") completeRun(job);
  else if (job.status === "failed") failRun(job.error ?? "Job failed.");
}

function stagesUpTo(stage) {
  const order = ["repo-selection","repository-sync","codex-execution","synthesis"];
  const idx = order.indexOf(stage);
  return idx <= 0 ? [] : order.slice(0, idx);
}

function completeRun(job) {
  state.jobEndTimestamp = Date.now();
  for (const stage of state.stages.keys()) {
    const cur = state.stages.get(stage);
    if (cur?.state === "running") setStageState(stage, "ok", new Date().toLocaleTimeString());
  }
  setStageState("synthesis", "ok", new Date().toLocaleTimeString(), "Answer ready.");

  const answerText = job.result?.synthesis?.text ?? "";
  state.currentAnswer = answerText;
  if (answerText) renderAnswer(answerText);

  const repos = Array.isArray(job.result?.selectedRepos) ? job.result.selectedRepos : [];
  renderRepos(repos);

  const success = $("run-summary-success");
  if (success) success.hidden = false;

  const button = $("ask-button");
  if (button) { button.disabled = false; button.textContent = button.dataset.defaultLabel ?? "Ask"; }
}

function failRun(message) {
  for (const stage of state.stages.keys()) {
    const cur = state.stages.get(stage);
    if (cur?.state === "running") setStageState(stage, "failed", message);
  }
  appendLog(`ERROR: ${message}`);
  const button = $("ask-button");
  if (button) { button.disabled = false; button.textContent = button.dataset.defaultLabel ?? "Ask"; }
}

function setStageState(stageId, stageState, time, subtitle) {
  const item = document.querySelector(`.progress-item[data-stage="${stageId}"]`);
  if (!item) return;
  item.dataset.state = stageState;
  const sub = item.querySelector(".progress-sub");
  const t = item.querySelector(".progress-time");
  if (subtitle && sub) sub.textContent = subtitle;
  if (time && t) t.textContent = time;

  const cur = state.stages.get(stageId) ?? { state: "waiting", startedAt: null };
  cur.state = stageState;
  if (stageState === "running" && !cur.startedAt) cur.startedAt = Date.now();
  state.stages.set(stageId, cur);
}

function renderAnswer(text) {
  const card = $("answer-card");
  const target = $("answer");
  if (!card || !target) return;
  if (window.marked && window.DOMPurify) {
    const html = window.marked.parse(text);
    const safe = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    target.innerHTML = safe;
  } else {
    target.textContent = text;
  }
  card.hidden = false;
}

function renderRepos(repos) {
  const empty = $("after-empty");
  const content = $("after-content");
  const list = $("after-repos");
  if (!list || !content || !empty) return;
  if (repos.length === 0) return;
  empty.hidden = true;
  content.hidden = false;
  list.innerHTML = "";
  for (const repo of repos) {
    const row = document.createElement("div");
    row.className = "repo-row";
    row.innerHTML = `<span>📁</span><div><div></div><div class="repo-path"></div></div>`;
    row.querySelector("div > div").textContent = repo.name;
    row.querySelector(".repo-path").textContent = repo.path ?? "";
    list.appendChild(row);
  }
}

function resetRun() {
  state.jobId = null;
  state.events = [];
  state.currentAnswer = null;
  state.jobStartTimestamp = null;
  state.jobEndTimestamp = null;
  for (const id of STAGE_ORDER) {
    state.stages.set(id, { state: "waiting", startedAt: null });
    const item = document.querySelector(`.progress-item[data-stage="${id}"]`);
    if (item) {
      item.dataset.state = "waiting";
      const t = item.querySelector(".progress-time");
      if (t) t.textContent = "";
    }
  }
  const log = $("full-log");
  if (log) log.textContent = "";
  const card = $("answer-card");
  if (card) card.hidden = true;
  const success = $("run-summary-success");
  if (success) success.hidden = true;
  const empty = $("after-empty");
  const content = $("after-content");
  if (empty && content) { empty.hidden = false; content.hidden = true; }
}

function appendLog(message) {
  const log = $("full-log");
  if (!log) return;
  log.textContent += `${new Date().toLocaleTimeString()} ${message}\n`;
  log.scrollTop = log.scrollHeight;
}

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString();
}

function parseSafe(text) {
  try { return JSON.parse(text); } catch { return null; }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Mode cookie/url updater (Task 16 wires the actual switch to this).
export function setMode(nextMode) {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(nextMode)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  const url = new URL(window.location.href);
  url.searchParams.set("mode", nextMode);
  window.history.replaceState(null, "", url.toString());
  window.location.reload();
}
```

- [ ] **Step 2.** `npm run check` (full check). Expected: typecheck, tests, build all pass.

## Task 15: Page snapshot test for Simple mode

**Files:**
- Create: `test/ui-page-snapshot.test.ts`

- [ ] **Step 1.** Add the test:

```typescript
import { describe, expect, it } from "vitest";

import { AppPage } from "../src/server/ui/pages/app-page.tsx";

describe("AppPage", () => {
  it("renders Simple mode shell with required hooks", async () => {
    const html = String(await AppPage({ mode: "simple" }));
    expect(html).toContain("data-mode=\"simple\"");
    expect(html).toContain("/ui/assets/styles.css");
    expect(html).toContain("/ui/assets/vendor/marked.min.js");
    expect(html).toContain("/ui/assets/vendor/purify.min.js");
    expect(html).toContain("/ui/assets/app.js");
    expect(html).toContain("id=\"question\"");
    expect(html).toContain("data-stage=\"job-created\"");
    expect(html).toContain("data-stage=\"synthesis\"");
  });
});
```

- [ ] **Step 2.** Run:

```bash
npm test -- --run ui-page-snapshot
```

Expected: 1 passing.

## Task 16: Step 2 manual verification + XSS smoke check

- [ ] **Step 1.** Start server: `npm run server`. Open `http://127.0.0.1:8787/`. Confirm: rainbow ATC logo, light theme by default, theme toggle works, drop zone accepts a file (UI only), Ask button submits a question, progress panel animates, answer renders.

- [ ] **Step 2.** XSS smoke check (mandatory). With the server running, edit `src/server/ui/assets/app.js` temporarily to inject test text:

```javascript
// In completeRun, before renderAnswer:
const answerText = "<script>window.__xssFired=true</script>" + (job.result?.synthesis?.text ?? "");
```

Submit any question, wait for completion, then in DevTools console run:

```javascript
window.__xssFired
```

Expected: `undefined`. Revert the temporary edit. Record the result in the task notes.

- [ ] **Step 3.** (Optional) commit:

```bash
git add -A
git commit -m "step 2: simple-mode UI"
```

---

# Step 3 — Expert mode + sidebar

## Task 17: Add expert components and wire Options panel into submit

**Files:**
- Create: `src/server/ui/components/sidebar.tsx`
- Create: `src/server/ui/components/mode-switch.tsx`
- Create: `src/server/ui/components/options-panel.tsx`
- Modify: `src/server/ui/pages/app-page.tsx`
- Modify: `src/server/ui/assets/app.js` (extend `buildPayload`)
- Modify: `package.json` (read version for sidebar footer)

- [ ] **Step 1.** Create `src/server/ui/components/sidebar.tsx`:

```tsx
const NAV: Array<{ section: string; items: Array<{ id: string; label: string; badge?: string }> }> = [
  { section: "Ask", items: [{ id: "new-ask", label: "+ New Ask" }, { id: "history", label: "History", badge: "0" }] },
  { section: "Repositories", items: [{ id: "repos", label: "All Repositories" }, { id: "sync-status", label: "Sync Status" }] },
  { section: "Config", items: [{ id: "config-path", label: "Config Path" }, { id: "edit-config", label: "Edit Config" }, { id: "init-config", label: "Init Config" }] },
  { section: "Tools", items: [{ id: "discover", label: "Discover GitHub" }, { id: "add-repository", label: "+ Add Repository" }] }
];

export function Sidebar({ version }: { version: string }) {
  return (
    <aside class="sidebar">
      <div>
        <img src="/ui/assets/logo.svg" alt="" width="48" height="24" />
        <h1>ask-the-code (ATC)</h1>
        <small style="color:#8b95a0">Repo-aware · Local</small>
      </div>
      {NAV.map(group => (
        <nav class="sidebar-section" aria-label={group.section}>
          <div class="sidebar-section-title">{group.section}</div>
          {group.items.map(item => (
            <a class="sidebar-link" href={`#${item.id}`} data-view={item.id}>
              <span>{item.label}</span>
              {item.badge ? <span class="sidebar-badge">{item.badge}</span> : null}
            </a>
          ))}
        </nav>
      ))}
      <div class="sidebar-footer">ATC v{version}</div>
    </aside>
  );
}
```

- [ ] **Step 2.** Create `src/server/ui/components/mode-switch.tsx`:

```tsx
export function ModeSwitch({ active }: { active: "simple" | "expert" }) {
  return (
    <div class="mode-switch" role="tablist">
      <button type="button" data-mode="simple" aria-pressed={active === "simple"}>⚡ Simple</button>
      <button type="button" data-mode="expert" aria-pressed={active === "expert"}>✦ Expert</button>
    </div>
  );
}
```

- [ ] **Step 3.** Create `src/server/ui/components/options-panel.tsx`:

```tsx
export function OptionsPanel() {
  return (
    <section class="card options-card" aria-labelledby="options-heading">
      <h2 id="options-heading">Options</h2>
      <div class="options-list">
        <label>Audience
          <select id="opt-audience">
            <option value="general" selected>General</option>
            <option value="codebase">Codebase</option>
          </select>
        </label>
        <label>Model
          <select id="opt-model">
            <option value="" selected>(default)</option>
            <option value="gpt-5.4">gpt-5.4</option>
            <option value="gpt-5.4-mini">gpt-5.4-mini</option>
          </select>
        </label>
        <label>Reasoning effort
          <select id="opt-reasoning">
            <option value="" selected>(default)</option>
            <option value="none">none</option>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="xhigh">xhigh</option>
          </select>
        </label>
        <label>Repo selection mode
          <select id="opt-selection-mode">
            <option value="" selected>(default)</option>
            <option value="cascade">cascade</option>
            <option value="single">single</option>
            <option value="none">none</option>
            <option value="low">low</option>
            <option value="high">high</option>
          </select>
        </label>
        <label class="toggle-row">Skip repository sync
          <input id="opt-no-sync" type="checkbox" />
        </label>
        <label class="toggle-row">No synthesis (raw results)
          <input id="opt-no-synthesis" type="checkbox" />
        </label>
        <label class="toggle-row">Selection shadow compare
          <input id="opt-shadow-compare" type="checkbox" />
        </label>
      </div>
    </section>
  );
}
```

(Repo selection mode values mirror `SUPPORTED_SELECTION_STRATEGIES` in `src/core/repos/selection-strategies.ts`. If that list disagrees with what's in the spec, prefer the constants — confirm before merging.)

- [ ] **Step 4.** Modify `src/server/ui/pages/app-page.tsx` to render Expert layout:

```tsx
import { html } from "hono/html";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AfterTheRun } from "../components/after-the-run.tsx";
import { AnswerCard } from "../components/answer-card.tsx";
import { AskCard } from "../components/ask-card.tsx";
import { Header } from "../components/header.tsx";
import { ModeSwitch } from "../components/mode-switch.tsx";
import { OptionsPanel } from "../components/options-panel.tsx";
import { ProgressPanel } from "../components/progress-panel.tsx";
import { Sidebar } from "../components/sidebar.tsx";

export type AppMode = "simple" | "expert";

export interface AppPageProps {
  mode: AppMode;
}

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "../../../../package.json"), "utf8"));
const VERSION = pkg.version ?? "0.0.0";

export function AppPage({ mode }: AppPageProps) {
  const expert = mode === "expert";
  return html`<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ask-the-code</title>
  <link rel="stylesheet" href="/ui/assets/styles.css" />
  <link rel="icon" type="image/svg+xml" href="/ui/assets/logo.svg" />
  <script src="/ui/assets/vendor/marked.min.js" defer></script>
  <script src="/ui/assets/vendor/purify.min.js" defer></script>
  <script type="module" src="/ui/assets/app.js" defer></script>
</head>
<body data-mode="${mode}">
  <div class="app-shell ${mode}">
    ${expert ? (<Sidebar version={VERSION} />) : null}
    <main class="main-area" id="main-area">
      ${(<>
        <Header />
        <ModeSwitch active={mode} />
        <AskCard />
        ${expert ? <OptionsPanel /> : null}
        <ProgressPanel />
        <AnswerCard />
        <AfterTheRun expert={${expert}} />
      </>)}
    </main>
  </div>
</body>
</html>`;
}
```

(The `${expert}` interpolation inside the JSX block is wrong — JSX accepts boolean directly. Adjust manually if the build complains; the simpler form is `<AfterTheRun expert={expert} />`.)

- [ ] **Step 5.** Update `src/server/ui/assets/app.js` `buildPayload` to read Expert options:

```javascript
function buildPayload(question) {
  const payload = { question };
  const audience = readSelect("opt-audience");
  const model = readSelect("opt-model");
  const reasoning = readSelect("opt-reasoning");
  const selection = readSelect("opt-selection-mode");
  const noSync = readChecked("opt-no-sync");
  const noSynthesis = readChecked("opt-no-synthesis");
  const shadow = readChecked("opt-shadow-compare");
  if (audience && audience !== "general") payload.audience = audience;
  if (model) payload.model = model;
  if (reasoning) payload.reasoningEffort = reasoning;
  if (selection) payload.selectionMode = selection;
  if (noSync) payload.noSync = true;
  if (noSynthesis) payload.noSynthesis = true;
  if (shadow) payload.selectionShadowCompare = true;
  return payload;
}

function readSelect(id) {
  const el = /** @type {HTMLSelectElement | null} */ (document.getElementById(id));
  return el?.value || null;
}
function readChecked(id) {
  const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
  return Boolean(el?.checked);
}
```

- [ ] **Step 6.** `npm run check`. Expected: typecheck + tests + build all pass.

## Task 18: Wire Simple/Expert switch and sidebar nav

**Files:**
- Modify: `src/server/ui/assets/app.js`

- [ ] **Step 1.** Add to the bottom of `init()`:

```javascript
  initModeSwitch();
  initSidebarNav();
```

- [ ] **Step 2.** Add the helpers:

```javascript
function initModeSwitch() {
  const buttons = document.querySelectorAll(".mode-switch button[data-mode]");
  buttons.forEach(btn => btn.addEventListener("click", () => {
    const target = btn instanceof HTMLElement ? btn.dataset.mode : null;
    if (!target || target === state.mode) return;
    setMode(target);
  }));
}

function initSidebarNav() {
  const links = document.querySelectorAll(".sidebar-link[data-view]");
  links.forEach(link => link.addEventListener("click", e => {
    e.preventDefault();
    const id = link instanceof HTMLElement ? link.dataset.view : null;
    if (!id) return;
    activateView(id);
    history.replaceState(null, "", `#${id}`);
  }));
  const initial = (window.location.hash || "#new-ask").slice(1);
  activateView(initial);
}

function activateView(id) {
  document.querySelectorAll(".sidebar-link[data-view]").forEach(l => {
    l.toggleAttribute("aria-current", l instanceof HTMLElement && l.dataset.view === id);
  });
  // For Step 3 we keep the main column visible for new-ask and repos; other views render as overlays in Task 19.
  if (id === "new-ask" || id === "repos") {
    showMainView(id);
  } else {
    showStubView(id);
  }
}

function showMainView(id) {
  // Default: ensure the question/progress/answer cards are visible.
  document.querySelectorAll("[data-stub-view]").forEach(el => el.remove());
  if (id === "repos") void renderRepoList();
}

function showStubView(id) {
  document.querySelectorAll("[data-stub-view]").forEach(el => el.remove());
  const messages = {
    history: { title: "No previous questions yet", body: "History is preview-only in this build." },
    "sync-status": { title: "Sync status view is coming soon", body: "Until then, run a job to trigger a sync." },
    "config-path": { title: "Config Path", body: "Web view coming soon." },
    "edit-config": { title: "Edit Config", body: "Web view coming soon." },
    "init-config": { title: "Init Config", body: "Web view coming soon." },
    discover: { title: "Discover GitHub", body: "Web view coming soon." },
    "add-repository": { title: "Add Repository", body: "Web view coming soon." }
  };
  const m = messages[id]; if (!m) return;
  const overlay = document.createElement("section");
  overlay.className = "card empty-state";
  overlay.dataset.stubView = id;
  overlay.innerHTML = `<strong></strong><div></div>`;
  overlay.querySelector("strong").textContent = m.title;
  overlay.querySelector("div").textContent = m.body;
  const main = document.getElementById("main-area");
  if (main) main.appendChild(overlay);
}

async function renderRepoList() {
  try {
    const response = await fetch("/repos", { headers: { Accept: "application/json" } });
    const data = await response.json();
    const repos = Array.isArray(data.repos) ? data.repos : [];
    const main = document.getElementById("main-area");
    if (!main) return;
    document.querySelectorAll("[data-stub-view]").forEach(el => el.remove());
    const overlay = document.createElement("section");
    overlay.className = "card";
    overlay.dataset.stubView = "repos";
    overlay.innerHTML = `<h2>All Repositories</h2><div id="repo-list"></div>`;
    const list = overlay.querySelector("#repo-list");
    if (repos.length === 0) {
      list.innerHTML = `<p class="empty">No configured repos.</p>`;
    } else {
      for (const repo of repos) {
        const row = document.createElement("div");
        row.className = "repo-row";
        row.innerHTML = `<span>📁</span><div><div></div><div class="repo-path"></div></div>`;
        row.querySelector("div > div").textContent = repo.name;
        row.querySelector(".repo-path").textContent = repo.description ?? repo.defaultBranch ?? "";
        list.appendChild(row);
      }
    }
    main.appendChild(overlay);
  } catch (error) {
    console.error("repos fetch failed", error);
  }
}
```

- [ ] **Step 3.** `npm run check`. Expected: pass.

## Task 19: Step 3 verification

- [ ] **Step 1.** Start server, open `http://127.0.0.1:8787/?mode=expert`. Verify sidebar renders, Simple/Expert tabs flip mode (reload), all sidebar items render their stub views, "All Repositories" shows the configured list (or "No configured repos").

- [ ] **Step 2.** With Expert mode active, set Audience=Codebase, Model=gpt-5.4, Reasoning=high, then submit a question. Confirm the request body sent to `/ask` includes those fields (Network tab in DevTools).

- [ ] **Step 3.** XSS smoke check again (Task 16, Step 2 procedure). Confirm `window.__xssFired` is `undefined`.

- [ ] **Step 4.** (Optional) commit:

```bash
git add -A
git commit -m "step 3: expert mode + sidebar"
```

---

# Step 4 — Port API routes to Hono

## Task 20: Port `/health` to Hono

**Files:**
- Create: `src/server/routes/health.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/api/http-server.ts` (delete `/health` block)

- [ ] **Step 1.** Create `src/server/routes/health.ts`:

```typescript
import type { Hono } from "hono";

import type { AppEnv } from "../app.ts";
import type { AskJobManager } from "../../core/types.ts";

export interface HealthDeps {
  jobManager: Pick<AskJobManager, "getStats">;
}

export function registerHealthRoutes(app: Hono<AppEnv>, deps: HealthDeps): void {
  app.get("/health", c => {
    const stats = typeof deps.jobManager.getStats === "function" ? deps.jobManager.getStats() : null;
    return c.json({ status: "ok", jobs: stats });
  });
}
```

- [ ] **Step 2.** In `src/server/api/http-server.ts`, remove the `/health` branch from `handleRequest`. The `createApp` call becomes the owner of the route via:

(In `startHttpServer`, where you call `createApp(...)`, add a `registerHealthRoutes(app, { jobManager: resolvedJobManager })` call. Pass `app` from `createApp` as the registration target — adjust `createApp` to return the Hono app, which it already does.)

- [ ] **Step 3.** `npm test -- --run http-server`. Expected: `/health` tests still pass (they hit Hono now via `app.fetch`, not the legacy handler — adjust the test harness if needed).

## Task 21: Port `/repos` to Hono

**Files:**
- Create: `src/server/routes/repos.ts`
- Modify: `src/server/app.ts` registration
- Modify: `src/server/api/http-server.ts` (delete `/repos` block)

- [ ] **Step 1.** Create `src/server/routes/repos.ts`:

```typescript
import type { Hono } from "hono";

import type { AppEnv } from "../app.ts";
import type { Environment, LoadedConfig, ManagedRepoDefinition } from "../../core/types.ts";

type RepoConfig = Pick<LoadedConfig, "repos">;
export type LoadRepoListFn = (env: Environment) => Promise<RepoConfig>;

export interface ReposDeps {
  env: Environment;
  loadConfigFn: LoadRepoListFn;
}

export function registerReposRoutes(app: Hono<AppEnv>, deps: ReposDeps): void {
  app.get("/repos", async c => {
    const config = await deps.loadConfigFn(deps.env);
    return c.json({
      repos: config.repos.map(serializeRepoSummary),
      setupHint: config.repos.length === 0
        ? 'No configured repos available. Try "atc config discover-github" to discover and add repos.'
        : null
    });
  });
}

function serializeRepoSummary(
  repo: Pick<ManagedRepoDefinition, "name" | "defaultBranch" | "description" | "aliases">
) {
  return {
    name: repo.name,
    defaultBranch: repo.defaultBranch,
    description: repo.description,
    aliases: repo.aliases
  };
}
```

- [ ] **Step 2.** Register in `startHttpServer` similarly to `health`. Remove `/repos` from `http-server.ts`.

- [ ] **Step 3.** Run `npm test -- --run http-server`. Adjust test harness as needed — same shape, hitting Hono now.

## Task 22: Port `/ask`, `/jobs/:id`, and SSE to Hono

**Files:**
- Create: `src/server/routes/ask.ts`
- Modify: `src/server/api/http-server.ts` (delete entire file by end of step)
- Modify: `src/server/app.ts` (registration), `src/server/main.ts` (no longer imports `startHttpServer`)
- Modify or rename: `test/http-server.test.ts` → `test/routes-ask.test.ts`

- [ ] **Step 1.** Create `src/server/routes/ask.ts` mirroring the existing route logic for `POST /ask`, `GET /jobs/:id`, and `GET /jobs/:id/events`. Use `hono/streaming` for SSE:

```typescript
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { AppEnv } from "../app.ts";
import type { AskJobManager, AskJobSnapshot, AskRequest, Environment, RepoSelectionStrategy } from "../../core/types.ts";
import {
  DEFAULT_ANSWER_AUDIENCE,
  isSupportedAnswerAudience,
  SUPPORTED_ANSWER_AUDIENCES
} from "../../core/answer/answer-audience.ts";
import { SUPPORTED_SELECTION_STRATEGIES, isSelectionStrategy } from "../../core/repos/selection-strategies.ts";

type HttpJobManager = Pick<AskJobManager, "createJob" | "getJob" | "subscribe"> & Partial<Pick<AskJobManager, "getStats">>;

export interface AskDeps {
  env: Environment;
  jobManager: HttpJobManager;
  bodyLimitBytes: number;
}

export function registerAskRoutes(app: Hono<AppEnv>, deps: AskDeps): void {
  app.post("/ask", async c => {
    const raw = await c.req.json().catch(() => null);
    const payload = normalizeAskRequest(raw);
    const job = deps.jobManager.createJob(payload);
    return c.json(withJobLinks(job), 202);
  });

  app.post("/jobs", () => {
    throw new HttpError(410, "POST /jobs was removed. Use POST /ask.");
  });

  app.get("/jobs/:id", c => {
    const id = decodeURIComponent(c.req.param("id"));
    const job = deps.jobManager.getJob(id);
    if (!job) throw new HttpError(404, `Unknown job: ${id}`);
    return c.json(withJobLinks(job));
  });

  app.get("/jobs/:id/events", c => streamJobEvents(c, deps.jobManager));

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: error.message }, error.statusCode);
    }
    return c.json({ error: error.message ?? "Internal error" }, 500);
  });
}

// ... normalizeAskRequest, normalizeRepoNames, normalizeAudience, etc., copied verbatim from http-server.ts ...

function streamJobEvents(c: Context<AppEnv>, jobManager: HttpJobManager): Response {
  const id = decodeURIComponent(c.req.param("id"));
  const job = jobManager.getJob(id);
  if (!job) throw new HttpError(404, `Unknown job: ${id}`);

  return streamSSE(c, async stream => {
    await stream.writeSSE({ data: JSON.stringify(withJobLinks(job)), event: "snapshot" });

    if (isTerminalStatus(job.status)) {
      await stream.writeSSE({ data: JSON.stringify(withJobLinks(job)), event: job.status });
      return;
    }

    const keepAlive = setInterval(() => { void stream.write(`: keep-alive\n\n`); }, 15_000);
    keepAlive.unref?.();

    await new Promise<void>(resolve => {
      const unsubscribe = jobManager.subscribe(id, async event => {
        await stream.writeSSE({ data: JSON.stringify(event), event: event.type });
        if (isTerminalStatus(event.type)) {
          const current = jobManager.getJob(id);
          if (current) await stream.writeSSE({ data: JSON.stringify(withJobLinks(current)), event: "snapshot" });
          clearInterval(keepAlive);
          unsubscribe();
          resolve();
        }
      });

      stream.onAbort(() => {
        clearInterval(keepAlive);
        unsubscribe();
        resolve();
      });
    });
  });
}

function withJobLinks(job: AskJobSnapshot) {
  return { ...job, links: { self: `/jobs/${encodeURIComponent(job.id)}`, events: `/jobs/${encodeURIComponent(job.id)}/events` } };
}

function isTerminalStatus(status: string): boolean { return status === "completed" || status === "failed"; }

class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; }
}

// (full normalize* helpers copied from http-server.ts)
```

(The `normalize*` helpers live in `http-server.ts` today — copy them into `ask.ts` verbatim. They have no shared state.)

- [ ] **Step 2.** Update `app.ts` to register all three route families. Remove the `app.all("*", ...)` legacy catch-all and remove the `legacyHandler` parameter from `createApp`. Update `main.ts` accordingly.

- [ ] **Step 3.** Delete `src/server/api/http-server.ts`.

- [ ] **Step 4.** Update tests:
  - Rename `test/http-server.test.ts` → split into `test/routes-ask.test.ts`, `test/routes-repos.test.ts`, `test/routes-health.test.ts`.
  - Each test exercises `app.fetch(new Request(...))` instead of the raw handler.
  - Preserve every assertion's intent — same status codes, same response shapes, same SSE event types and ordering.

- [ ] **Step 5.** `npm run check`. Expected: pass.

## Task 23: Step 4 verification

- [ ] **Step 1.** Manual smoke: `npm run server`, then exercise each endpoint via curl with the same payloads existing tests use. Ensure SSE behaves identically (run a real Codex job end-to-end).

- [ ] **Step 2.** (Optional) commit.

---

# Step 5 — Cleanup

## Task 24: Delete `html.ts` and finalize docs

**Files:**
- Delete: `src/server/ui/html.ts`
- Modify: `specs/architecture.md`, `specs/http-api.md`, `README.md` if anything user-visible changed (most likely architecture.md only — to describe the new file layout).

- [ ] **Step 1.** Delete `src/server/ui/html.ts`. Search the codebase for remaining references and remove them:

```bash
git grep -n "ui/html\|HTML_UI"
```

Expected: no hits after cleanup.

- [ ] **Step 2.** Update `specs/architecture.md` with one paragraph describing the Hono-based server, the `routes/` layout, and where the UI assets live. Update `specs/http-api.md` only if any contract actually changed (it should not have).

- [ ] **Step 3.** XSS smoke check (Task 16, Step 2 procedure) one final time. Record the result.

- [ ] **Step 4.** `npm run check` final. Expected: pass.

- [ ] **Step 5.** (Optional) commit:

```bash
git add -A
git commit -m "step 5: delete legacy html.ts and update docs"
```

---

## Self-review notes

- Spec coverage: every spec section maps to at least one task (Step 1: 1–7, Step 2: 8–16, Step 3: 17–19, Step 4: 20–23, Step 5: 24).
- Markdown rendering security: pipeline implemented in `app.js` Task 14 step 1 (`renderAnswer`), libraries vendored in Task 3, XSS check repeated at Tasks 16, 19, 24.
- Stage mapping is the only piece with non-trivial logic and has dedicated unit tests in Task 8.
- Cookie semantics (Path=/, Max-Age, SameSite) appear in `routes/ui.ts` Task 13 step 1 and `app.js` `setMode` Task 14 step 1.
- HttpBindings approach is implemented in `app.ts` Task 5; replaced in Task 22.
- Provenance sidecars created in Task 3.
