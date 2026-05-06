# Architecture

ask-the-code answers questions about how your code behaves by resolving the in-scope repos, syncing them locally, and running Codex against the right workspace. The same core flow is shared by the CLI and the optional HTTP server.

The repository is TypeScript-first: source lives in `src/` as ESM TypeScript, and package/runtime artifacts are emitted to `dist/`. The published package surface is intentionally limited to the `atc` and `atc-server` binaries rather than a consumable module export.

## Component map

```mermaid
flowchart LR
  CLI["atc CLI"] --> CLIAdapter["CLI adapter"]
  HTTP["atc-server HTTP API"] --> HttpAdapter["HTTP adapter"]
  HTTP --> WebUI["Built-in web UI"]
  HttpAdapter --> Jobs["Ask job manager"]
  CLIAdapter --> Core["Question-answering core"]
  Jobs --> Core

  Core --> Config["Config loader"]
  Core --> Selection["Repo selection"]
  Core --> Sync["Repo sync"]
  Core --> Codex["Codex runner"]

  SyncCoordinator["Repo sync coordinator"] --> Sync
  Jobs --> SyncCoordinator

  CLIAdapter --> Render["CLI renderer"]
  HttpAdapter --> Polling["Job snapshots"]
  HttpAdapter --> SSE["SSE event stream"]
  WebUI --> Polling
  WebUI --> SSE

  Config --> UserConfig["User config file"]
  Sync --> ManagedRepos["Managed local repos"]
  Codex --> CodexCli["Local codex exec CLI"]
```

## High-level flow

1. A transport adapter receives a request, including the question plus optional audience and execution overrides.
2. Commands that require Git check that the local `git` CLI is installed before continuing.
3. Discovery commands check that GitHub access is available via `GH_TOKEN` / `GITHUB_TOKEN` or, if those env vars are unset, via a usable `gh` login before continuing.
4. Commands that require Codex check that the local `codex` CLI is installed and `codex login status` reports a logged-in session before continuing.
5. Config is loaded from the user config path.
6. Repo selection honors explicit repo names when provided; otherwise it asks Codex to choose from the configured repo metadata with minimal reasoning, keeps any pinned repos in scope, falls back to heuristic scoring if that selector pass fails or returns unusable output, and finally falls back to all configured repos when nothing scores positively.
7. Repo sync clones missing selected repos, unshallows any shallow managed checkout, and then fast-forwards it to the configured tracked branch tip.
8. Codex runs against either the single selected repo or the managed repos root.
9. The adapter renders the result:
   - CLI: text to stdout plus status to stderr
   - HTTP: async job state plus SSE status events, with the web UI rendering Simple and Advanced modes on top of the same endpoints

## HTTP ask flow

```mermaid
sequenceDiagram
  participant Client as "HTTP client"
  participant Server as "atc-server"
  participant Jobs as "Ask job manager"
  participant Core as "Question-answering core"
  participant Sync as "Sync coordinator"
  participant Codex as "Codex runner"

  Client->>Server: POST /ask (+ optional JSON or multipart attachments)
  Server->>Jobs: create job
  Jobs-->>Client: 202 Accepted + job links

  Client->>Server: GET /jobs/:id/events
  Server-->>Client: snapshot event

  Jobs->>Core: run answerQuestion()
  Core->>Sync: sync selected repos
  Sync-->>Core: sync report
  Core->>Codex: run codex exec with question + attachment content/paths or skip with noSynthesis
  Codex-->>Core: synthesis result
  Core-->>Jobs: final result + status messages
  Jobs-->>Server: completed job state
  Server-->>Client: status/completed events
```

## Sync coordination

Within one `atc-server` process, concurrent jobs share repo sync work by repo directory. If one job is already cloning or updating a repo, later jobs wait for that same in-flight sync result instead of starting a second clone or pull. This coordination is in-memory only, so it applies inside a single server process, not across multiple processes.

## Main modules

- `src/cli/main.ts`
  Dispatches commands, resolves question files, prints output, handles interactive CLI bootstrap when config is missing or freshly initialized without repos, and lets direct `config discover-github` prompt for an owner or default to `@accessible` when `--owner` is omitted.
- `src/server/main.ts`
  Parses server startup arguments, reuses the same interactive config bootstrap flow as `atc`, and then boots the HTTP adapter.
- `src/server/app.ts`
  Builds the Hono application, installs shared CORS handling, serves static UI assets, mounts the web UI, mounts API routes, and returns JSON 404s for unknown routes.
- `src/server/http-server.ts`
  Creates the per-process job manager, serves the Hono app through the Node adapter, and coordinates graceful shutdown with queued/running jobs.
- `src/cli/setup/bootstrap.ts`
  Hosts the shared interactive CLI prompts and bootstrap flow for missing-config initialization and optional GitHub discovery continuation, including the Enter-to-use-`@accessible` owner shortcut.
- `src/core/config/config-paths.ts`
  Resolves the active config path from `ATC_CONFIG_PATH` or `~/.config/atc/config.json`, plus the default managed repos root under `~/.local/share/atc/repos`.
- `src/core/config/config.ts`
  Loads and validates config, bootstraps a config file from scratch or from an imported catalog, applies selected GitHub discovery additions or overrides into the active config, and drafts fallback routing cards from legacy repo `topics` / `classifications` when `routing` is still missing.
  Derives each GitHub managed checkout directory from the repo's GitHub identity, so checkouts live under owner-scoped paths like `leanish/nullability` or `OtherCo/dtv` even when the configured repo name stays plain.
- `src/core/discovery/github-catalog.ts`
  Discovers repos from a GitHub user or org, or from the special `@accessible` scope that spans the authenticated user's personal and organization-visible repos.
  Uses authenticated GitHub access from `GH_TOKEN` / `GITHUB_TOKEN` or, if those env vars are unset, the current `gh` login so private repos and higher rate limits can be used.
  Normalizes repos into repo definitions, preserves source-owner metadata for multi-owner discovery displays, auto-qualifies owner-colliding repo names as `<owner>/<repo>`, supports a names-first selection pass without per-repo topic fetches, and then refines only the selected subset with repo-content inspection plus a Codex cleanup pass before comparing the result with the current config to classify additions, conflicts, and metadata review suggestions.
- `src/core/discovery/discovery-pipeline.ts`
  Orchestrates the shared discovery flow used by both CLI and server bootstrap: fetch discovery results, plan additions and overrides, resolve the selected subset, refine only that subset, apply the selected repos into config in one write, and build the final applied summary.
- `src/core/discovery/github-discovery-auth.ts`
  Checks whether GitHub discovery can authenticate via `GH_TOKEN` / `GITHUB_TOKEN` or, as a fallback, via a usable `gh` CLI session, and formats user-facing setup guidance when neither path is available.
- `src/core/discovery/repo-display-utils.ts`
  Provides shared owner-label, repo-identity, and grouping helpers so interactive selection and rendered discovery summaries stay aligned on how owner-qualified names are derived and displayed.
- `src/cli/setup/discovery-progress.ts`
  Formats stderr progress updates for GitHub discovery so CLI and server bootstrap flows do not look stuck while repo names are being listed or selected repos are being curated.
- `src/cli/setup/discovery-selection.ts`
  Resolves explicit or interactive discovery selections so GitHub imports can add only chosen repos and override only chosen configured repos, using a combined interactive list of new and already configured repos with an Enter-to-add-all-new confirmation path and owner-grouped multi-owner displays that only fall back to owner-qualified repo labels when names collide, while still accepting owner-qualified identifiers case-insensitively for explicit selections.
- `src/core/discovery/repo-classification-inspector.ts`
  Reuses an existing managed checkout when available, otherwise shallow-clones a selected repo temporarily, then inspects repo structure, manifests, dependencies, routes, and README cues to infer fallback descriptions plus a draft routing card describing owned behavior, exposed surfaces, consumed technologies, workflows, and selection boundaries.
- `src/core/discovery/repo-metadata-codex-curator.ts`
  Runs a Codex cleanup pass in the inspected repo checkout to refine the heuristic discovery draft into the final description and routing card written during selected-repo discovery apply flows.
- `src/core/answer/question-answering.ts`
  Implements the transport-agnostic ask flow and accepts injectable adapters such as status reporters and sync functions.
- `src/core/repos/repo-selection.ts`
  Resolves explicit repo names and aliases, or asks Codex to choose from configured repo metadata with a routing-aware heuristic fallback that scores likely repos from repo-name tokens, descriptions, and routing evidence while keeping repos marked `alwaysSelect` in scope, optionally cascading selector reasoning effort, and falling back to all configured repos when nothing scores positively.
- `src/core/repos/repo-sync.ts`
  Clones missing repos and fast-forwards existing repos to the latest remote configured tracked branch tip, first unshallowing any shallow managed checkout.
- `src/core/git/git-installation.ts`
  Checks whether the local `git` CLI is installed and formats user-facing installation guidance when it is missing.
- `src/core/repos/repo-sync-coordinator.ts`
  Deduplicates concurrent syncs for the same repo within a single server process.
- `src/core/codex/codex-runner.ts`
  Wraps `codex exec`, manages the audience-aware prompt, heartbeats, execution timeout, and final-message capture.
- `src/core/codex/codex-installation.ts`
  Checks whether the local `codex` CLI is installed and logged in, and formats user-facing installation/login guidance when it is not ready.
- `src/core/jobs/ask-job-manager.ts`
  Maintains in-memory async jobs, per-job event history, and bounded execution concurrency.
- `src/server/routes/ask.ts`
  Exposes `POST /ask`, `GET /jobs/:id`, `GET /jobs/:id/events`, and the removed `POST /jobs` compatibility error using Hono route handlers. Browser multipart uploads are saved as temporary file attachments and cleaned up after terminal job events.
- `src/server/routes/api-ask.ts`
  Exposes API-only `POST /api/v1/ask` and `GET /api/v1/history`, enforcing bearer-token plus signed interaction headers and accepting only Simple-mode ask bodies.
- `src/server/api-history-store.ts`
  Persists API conversation history to a local JSON file with an in-process write queue and temp-file-plus-rename writes.
- `src/server/routes/auth.ts`
  Exposes GitHub SSO session, login, callback, and logout endpoints for the built-in web UI. Sessions are local signed cookies with a 30-day sliding expiry and no per-session server-side invalidation list; GitHub OAuth credentials come from environment variables.
- `src/server/routes/repos.ts`
  Exposes the configured repo catalog consumed by the Advanced mode repositories view.
- `src/server/routes/health.ts`
  Exposes the server health and in-memory job counts.
- `src/server/routes/ui.tsx`
  Renders the built-in web UI at `GET /`, resolving Simple or Advanced mode from `?mode=` and the `atc_mode` cookie.
- `src/server/ui/pages/` and `src/server/ui/components/`
  Contain the Hono JSX page and component tree for the built-in web UI.
- `src/server/ui/assets/`
  Contains the browser JavaScript, stylesheet, stage-mapping helper, and vendored markdown/sanitizer assets copied into `dist/` during `postbuild`.
- `src/cli/render.ts`
  Converts results into simple CLI output.
- `src/core/status/status-reporter.ts`
  Adapts status messages to stderr or other consumers such as job event streams.

## Configuration model

The installed config file owns:

- the root directory used for managed clones
- the list of managed repos

Repo definitions include:

- `name`
- `url`
- `defaultBranch`
- `description`
- `routing`
  A structured routing card with `role`, `reach`, `responsibilities`, `owns`, `exposes`, `consumes`, `workflows`, `boundaries`, `selectWhen`, and `selectWithOtherReposWhen`.
- optional `aliases`
- optional `alwaysSelect`

Repo names and aliases are validated eagerly and must be unique case-insensitively.

## HTTP runtime model

- jobs are kept in memory only
- completed jobs expire after a retention window
- server concurrency is bounded to avoid spawning unbounded Codex processes
- server shutdown cancels queued jobs, drains running jobs, and clears manager state after the drain completes
- repo sync coordination is per-process and keyed by repo directory
- SSE clients receive a snapshot first, then live events until the job reaches a terminal state

## Testing model

- Vitest is used for unit tests.
- Coverage is enforced on statements and branches.
- The highest-value tests cover:
  - argument parsing
  - config loading and initialization
  - repo selection
  - Codex runner behavior and error handling
  - sync coordination
  - async job lifecycle
  - HTTP request handling and SSE behavior
