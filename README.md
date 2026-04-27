# ask-the-code

ask-the-code is your personal code archaeologist. Ask your codebase how it behaves.

ask-the-code exposes two adapters over the same repo-aware question-answering core:

- the `atc` CLI for local terminal use
- the `atc-server` HTTP server for async job-based integrations

Install the `ask-the-code` package, then run the shorter `atc` and `atc-server` commands.

Both adapters manage a configured set of repositories, keep them in sync, and use the local `codex exec` CLI to answer codebase questions across them.

The source is written as TypeScript ESM under `src/`. Published CLI entrypoints are built into `dist/bin/`.
The published package is CLI-only and intentionally exposes no importable library entrypoint.

The project is intentionally split in two:

- source code in this repo
- managed repo definitions in user config, not in Git

This keeps the tool reusable while still letting each installation decide which repos to manage.

ask-the-code requires local `git` on `PATH` for repo sync and GitHub discovery, plus the local `codex` CLI on `PATH` and a logged-in Codex session for synthesis and curated discovery.

Install the required local CLIs with:

```bash
brew install git
brew install codex
```

Then make sure `codex login status` reports a logged-in session.

For discovery, either export `GH_TOKEN` / `GITHUB_TOKEN`, or, if you prefer, install `gh` with

```bash
brew install gh
gh auth login
```

## Quick Start

Start either adapter and follow the built-in setup guidance from there:

```bash
atc "How does this codebase behave?"
```

or

```bash
atc-server
```

When no config exists yet, ask-the-code will prompt to initialize it and can continue directly into GitHub discovery from that flow. You do not need to run `atc config init` first unless you prefer to manage setup manually.

This project follows a simple layout:

- `src/cli/` for the TypeScript CLI entrypoint, argument parsing, terminal rendering, and interactive setup UX
- `src/server/` for the TypeScript server entrypoint, HTTP API, and built-in web UI
- `src/core/` for shared application logic such as config, discovery, repo sync, job execution, and Codex integration
- `dist/` for compiled publishable runtime output
- tests in `test/`
- coverage target: 80% statements and branches

For local development:

```bash
npm install
npm run typecheck
npm test
npm run build
```

After `npm install`, Husky installs the repo Git hooks automatically. Commits run `npm run check`, which executes typechecking, the test suite, and the build before Git creates the commit.

To run the server directly from TypeScript source during development, use:

```bash
npm run server
```

That path does not require rebuilding `dist/`, so rerunning it after source edits will pick up the latest `src/` changes.

To run the CLI directly from TypeScript source during development, use:

```bash
npm run cli -- "How does this codebase behave?"
```

## Configuration

By default, `atc` reads config from:

```text
~/.config/atc/config.json
```

You can override that path with:

```bash
export ATC_CONFIG_PATH=/path/to/config.json
```

The config file contains:

- `managedReposRoot`: where local clones live
- `repos`: the curated repo list, including URL, branch, description, a structured `routing` card, and optional aliases

Repo names and aliases must be unique case-insensitively. Aliases must be non-empty strings.
GitHub repos are always stored under an owner-scoped path inside `managedReposRoot`, such as `.../repos/leanish/nullability` or `.../repos/OtherCo/dtv`, using the owner casing from GitHub.
If an older config still has repo-level `topics` and `classifications` but no `routing`, ask-the-code drafts a fallback routing card from those legacy fields while loading the config. Re-running GitHub discovery is still the preferred way to replace those drafts with curated routing metadata.

Example using a few public `leanish` repos:

```json
{
  "managedReposRoot": "/Users/you/.local/share/atc/repos",
  "repos": [
    {
      "name": "sqs-codec",
      "url": "https://github.com/leanish/sqs-codec.git",
      "defaultBranch": "main",
      "description": "automatic compression+encoding for SQS Messages",
      "routing": {
        "role": "shared-library",
        "reach": ["java-library"],
        "responsibilities": [
          "Encodes and decodes SQS payload metadata."
        ],
        "owns": [
          "message compression and checksum behavior"
        ],
        "exposes": [
          "Java library APIs"
        ],
        "consumes": [
          "AWS SQS"
        ],
        "workflows": [
          "message encode and decode flows"
        ],
        "boundaries": [
          "Do not select for SQS infrastructure provisioning."
        ],
        "selectWhen": [
          "The question is about SQS payload encoding, compression, or checksum behavior."
        ],
        "selectWithOtherReposWhen": []
      },
      "aliases": [],
      "alwaysSelect": false
    },
    {
      "name": "java-conventions",
      "url": "https://github.com/leanish/java-conventions.git",
      "defaultBranch": "main",
      "description": "Shared Gradle conventions for Java projects",
      "routing": {
        "role": "build-tooling",
        "reach": ["gradle-plugin"],
        "responsibilities": [
          "Defines shared Gradle conventions for Java builds."
        ],
        "owns": [
          "build conventions and plugin defaults"
        ],
        "exposes": [
          "Gradle plugins"
        ],
        "consumes": [
          "Gradle"
        ],
        "workflows": [
          "shared Java build setup"
        ],
        "boundaries": [],
        "selectWhen": [
          "The question is about shared Gradle plugin behavior or Java build defaults."
        ],
        "selectWithOtherReposWhen": []
      },
      "aliases": [],
      "alwaysSelect": false
    },
    {
      "name": "ask-the-code",
      "url": "https://github.com/leanish/ask-the-code.git",
      "defaultBranch": "main",
      "description": "ask-the-code is your personal code archaeologist. Ask your codebase how it behaves.",
      "routing": {
        "role": "developer-cli",
        "reach": ["cli", "http-server"],
        "responsibilities": [
          "Runs repo-aware question answering through a CLI and HTTP server."
        ],
        "owns": [
          "repo discovery",
          "repo selection",
          "codex execution"
        ],
        "exposes": [
          "atc CLI",
          "atc-server"
        ],
        "consumes": [
          "Codex CLI",
          "GitHub API",
          "git"
        ],
        "workflows": [
          "repo-aware engineering Q&A"
        ],
        "boundaries": [],
        "selectWhen": [
          "The question is about ask-the-code CLI, server, discovery, selection, or Codex integration behavior."
        ],
        "selectWithOtherReposWhen": []
      },
      "aliases": [],
      "alwaysSelect": false
    }
  ]
}
```

Repos may also set `"alwaysSelect": true` to stay in scope during automatic repo selection. This is useful for foundational repos that should always be available when ask-the-code narrows to likely matches. Automatic selection now routes on ownership-oriented metadata such as `routing.role`, `routing.owns`, `routing.exposes`, `routing.workflows`, and explicit boundaries instead of relying on flat topic bags. By default, ask-the-code uses `--selection-mode single`, which runs one `reasoningEffort: "none"` selector pass, merges any `alwaysSelect` repos into that result, and falls back to local heuristic scoring when the selector call fails or returns unusable output. `--selection-mode cascade` escalates through `none`, `minimal`, `low`, `medium`, and `high` until the selector returns a confident usable result. When `--selection-shadow-compare` is enabled, ask-the-code also runs `none`, `low`, and `high` selection passes in the background and records the finished comparison in the result diagnostics. Treat shadow compare as a diagnostic benchmark rather than a default setting, because it starts 3 parallel selector calls.

Bootstrap an empty config:

```bash
atc config init
```

When `config init` creates a config with zero repos, it prints the next step:

```bash
atc config discover-github
```

That flow discovers repos with GitHub metadata plus curated descriptions and routing cards. Discovery uses `GH_TOKEN` / `GITHUB_TOKEN` when available, and otherwise can fall back to a usable `gh` login. It can include private repos visible to that credential. When GitHub metadata is sparse, ask-the-code inspects README text, routes, manifests, and dependencies to draft routing metadata, then runs a Codex cleanup pass over that draft to improve precision.

Initialize config from an existing catalog file:

```bash
atc config init \
  --catalog /path/to/catalog.json \
  --managed-repos-root /Users/leandro.aguiar/.local/share/atc/repos
```

Discover repos and choose what to add or override. When `--owner` is omitted, ask-the-code prompts on a TTY and otherwise defaults to `@accessible`:

```bash
atc config discover-github
```

Target a specific GitHub user or org explicitly:

```bash
atc config discover-github --owner leanish
```

To list all repos visible through your authenticated GitHub access across personal and organization scopes:

```bash
atc config discover-github --owner @accessible
```

While discovery runs, ask-the-code prints progress updates so the command does not look stuck.

Use the same command to select additions or overrides from that owner into the active config:

```bash
atc config discover-github
```

When the command runs in a terminal, ask-the-code prompts once with the combined list of new and already configured repos. If you did not pass `--owner`, that flow first prompts for a GitHub owner and accepts Enter for `@accessible`. Multi-owner discovery groups repos by owner for readability, and only falls back to owner-qualified names when repo names collide. If two GitHub repos would otherwise collide by plain name, ask-the-code automatically uses an owner-qualified config name such as `otherco/nullability` so both can coexist. Managed checkouts are owner-scoped on disk for GitHub repos even when the configured name stays plain. Press Enter to add all new repos, or type names to customize the selection; a confirmation prompt avoids doing that silently. Anything you pick gets added or overridden as needed. For scripted use, pass `--owner`, `--add <names>`, and `--override <names>`, or use `*` to select all repos of that kind. Owner-qualified names such as `leanish/nullability` are accepted case-insensitively when you want to be explicit.

By default, GitHub discovery includes forks and skips archived or disabled repos. Use `--exclude-forks` to hide forks, and `--include-archived` to keep archived repos in scope. GitHub may also report some archived repos as disabled, so that flag can surface both. Discovery uses `GH_TOKEN` / `GITHUB_TOKEN` when available, or an existing `gh` login otherwise. Discovery includes private repos visible to that credential. The first pass is intentionally names-first: ask-the-code lists the eligible repos so you can choose what to add or override without paying for per-repo inspection up front. After selection, ask-the-code refines only the chosen subset: it fills blank descriptions when needed, drafts routing cards from GitHub metadata plus inspected README, route, manifest, and dependency signals, and then runs a Codex cleanup pass before saving the selected repos into config in one write. The routing card separates owned behavior from consumed technologies, exposed surfaces, and explicit selection boundaries so repo selection can prefer ownership over keyword overlap. When a selected repo is already cloned under the managed repos root, discovery inspects that local checkout; otherwise it can shallow-clone the repo temporarily to inspect and curate metadata from source structure and README cues. Overrides update the configured repo's URL, default branch, description, and routing while preserving local-only fields such as aliases and `alwaysSelect`.

When either `atc` or `atc-server` starts with no `config.json` and stdin/stdout are attached to a TTY, ask-the-code prompts to initialize the config instead of only failing with a command suggestion. If that new config still has zero repos, it can then prompt to continue directly into `discover-github`, ask for the GitHub owner, and resume the original command after discovery. Pressing Enter at that owner prompt uses `@accessible`, which discovers all repos visible through your authenticated GitHub access across personal and organization scopes. Outside that interactive CLI flow, `config init`, `atc-server` startup, repo-listing output, and the web UI empty state still surface `atc config discover-github` as the recovery path.

Print the active config path:

```bash
atc config path
```

## Usage

List the configured repos:

```bash
atc repos list
```

Clone or update all configured repos:

```bash
atc repos sync
```

Clone or update only a few repos:

```bash
atc repos sync sqs-codec,java-conventions
```

Ask a question. By default `atc` will:

1. ask Codex to choose likely repos from the configured repo metadata with `reasoningEffort: "none"`, while keeping any repos marked with `"alwaysSelect": true` in scope
   If that selector pass fails or returns unusable output, ask-the-code falls back to local heuristic scoring over repo names, descriptions, and routing metadata. If nothing scores positively there, all configured repos are used.
2. sync them to the latest tracked trunk tip
3. run `codex exec` with `gpt-5.4-mini` and `low` reasoning effort

Use `--selection-mode cascade` when you want repo selection itself to escalate from `none` through higher reasoning efforts before falling back, and `--selection-shadow-compare` when you want ask-the-code to benchmark `none`, `low`, and `high` repo selection in the background for comparison diagnostics. Keep shadow comparison off for normal use on resource-constrained local models.

By default, answers target non-engineering readers who need the system behavior explained clearly. When the reader can inspect the repositories directly, use `--audience codebase` to get a more implementation-oriented answer.

While it runs, `atc` keeps progress reporting high-level, including repo-selection timing, whether repo sync is being skipped, and a heartbeat every 5 seconds during long Codex runs. Raw nested Codex logs stay hidden unless the command fails.

Managed repos are synced against their configured `defaultBranch`. Discovery’s temporary inspection clones are shallow. Managed repo sync uses normal long-lived checkouts; if a managed repo happens to be shallow, ask-the-code first runs `git fetch --unshallow` before the normal fast-forward update flow.

A few example questions against public `leanish` repos:

```bash
atc "How does sqs-codec encode compression and checksum metadata in x-codec-meta?"
atc "How does java-conventions infer leanish.conventions.basePackage when the property is missing?"
atc "How does ask-the-code choose the Codex working directory when one repo matches versus several?"
```

Force a specific repo set:

```bash
atc --repo sqs-codec "What does skipCompressionWhenLarger do when compression would make the payload larger?"
```

When only one repo is selected, Codex runs with that repo as its working directory. Otherwise it runs from the configured managed repos workspace root.

Read the question from a file:

```bash
atc --repo java-conventions --question-file /path/to/question.txt
```

Switch the answer audience when you want repo-level implementation detail:

```bash
atc --repo ask-the-code --audience codebase "Which modules shape the Codex prompt and pick the working directory?"
```

Skip repo sync first:

```bash
atc --repo ask-the-code --no-sync "How does codex-runner emit heartbeats and capture the final answer?"
```

For repeated questions against repos that are already up to date, prefer `--no-sync` to avoid paying the clone/pull cost on every run.

Show only the selected repos and sync results, even if syncing fails:

```bash
atc --repo sqs-codec,java-conventions --no-synthesis "Which repo defines the default coverage threshold, and which repo consumes it?"
```

## HTTP server

Start the optional HTTP adapter with explicit flags:

```bash
atc-server --host 127.0.0.1 --port 8787
```

You can also configure the bind host and port with environment variables:

```bash
ATC_SERVER_HOST=127.0.0.1 ATC_SERVER_PORT=8787 atc-server
```

When both are provided, command-line flags override the environment values.
Server startup validates the active config eagerly and fails before binding the port if `config.json` is invalid. It also checks that the local `codex` CLI is installed before the server starts listening.

The server exposes async jobs over HTTP. Submit a new question with `POST /ask`, then use the returned `/jobs/:id` and `/jobs/:id/events` links to poll or stream progress. Legacy clients using `POST /jobs` must switch to `POST /ask`.

Create a job:

```bash
curl -sS \
  -X POST http://127.0.0.1:8787/ask \
  -H 'content-type: application/json' \
  -d '{
    "question": "How does ask-the-code choose the Codex working directory when one repo matches versus several?",
    "repoNames": ["ask-the-code"]
  }'
```

The response includes a job id plus links:

```json
{
  "id": "8eb9d8b3-2fd4-4f29-b2af-7273b92b7a6d",
  "status": "queued",
  "links": {
    "self": "/jobs/8eb9d8b3-2fd4-4f29-b2af-7273b92b7a6d",
    "events": "/jobs/8eb9d8b3-2fd4-4f29-b2af-7273b92b7a6d/events"
  }
}
```

When `model` or `reasoningEffort` are omitted from the HTTP request, the server uses the same defaults as the CLI: `gpt-5.4-mini` and `low`.
When `audience` is omitted, the server defaults to `general`, which assumes no knowledge of source code or implementation details and avoids unnecessary references to the analyzed workspace's files or symbols. Service and integration examples are still allowed when they help explain behavior. Use `codebase` when the reader can inspect the managed repos directly and wants file- and symbol-level detail.
When `selectionMode` is omitted, the server defaults to `single`. Set `selectionMode` to `cascade` to escalate repo selection effort before falling back, and set `selectionShadowCompare` to `true` to keep background `none`/`low`/`high` selector runs for comparison diagnostics.

Poll job state:

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>
```

Stream status updates with server-sent events:

```bash
curl -sS -N http://127.0.0.1:8787/jobs/<job-id>/events
```

Available endpoints:

- `GET /health`
- `GET /repos`
- `POST /ask`
- `GET /jobs/:id`
- `GET /jobs/:id/events`

HTTP jobs keep an in-memory event history, run with bounded concurrency, and share a per-process repo sync coordinator. If two jobs need the same repo sync at the same time, one sync runs and the other job waits for the same result.
`GET /health` reports only the currently retained in-memory job counts, so `completed` and `failed` reset after the retention window and on server restart.

When the HTTP server shuts down through its returned handle, queued jobs fail fast and running jobs are allowed to finish before the manager is cleared. `atc-server` wires `SIGTERM` and `SIGINT` to that shutdown path, and a second signal forces an immediate exit.

### Web UI

Open `http://127.0.0.1:8787` in a browser to use the built-in web UI. The UI streams job status updates in real time over server-sent events and renders the answer as sanitized markdown.

The page has two layouts:

- **Simple** (default): question, file drop zone, progress, and answer. No backend options exposed.
- **Expert**: adds a left sidebar (history, repositories, sync status, config, tools) and a right-side options panel where you can choose audience, model, reasoning effort, repo selection mode, optional skip-sync and no-synthesis toggles, and an optional background shadow-comparison run. The default audience is `general`.

Switch layouts via the Simple/Expert toggle at the top of the page or by visiting `?mode=expert`. The chosen mode persists in the `atc_mode` cookie (one year, `SameSite=Lax`) and survives browser restarts. The light/dark theme toggle in the header persists in `localStorage` and defaults to the operating-system preference.

`GET /` always returns the HTML page. Programmatic clients should use the dedicated JSON endpoints (`GET /repos`, `GET /health`, `GET /history`, `GET /auth/me`, `POST /ask`, `GET /jobs/:id`, `GET /jobs/:id/events`).

### File attachments

The Ask card accepts files via drag-and-drop or the Attach files button (PDF, PNG, JPG, MP4, MOV, TXT — up to 100 MB each, max 10 per question). When attachments are present, the browser submits `POST /ask` as `multipart/form-data` with a `payload` JSON field plus `file_<i>` parts. The server stores each file under the OS temp directory, lists them in the Codex prompt with their on-disk paths so Codex's tools can read them, and removes the temp directory after the job reaches a terminal status.

### GitHub sign-in

Optional. When the server has `ATC_GITHUB_CLIENT_ID`, `ATC_GITHUB_CLIENT_SECRET`, and `ATC_SESSION_SECRET` set, the header shows a "Sign in with GitHub" button that runs the OAuth flow against `github.com/login/oauth`. The session is stored in a signed `atc_session` cookie (`HttpOnly; SameSite=Lax`, 7 days). Without those env vars the button still appears but explains that sign-in is not configured. Endpoints: `GET /auth/github/login`, `GET /auth/github/callback`, `GET /auth/me`, `POST /auth/logout`. Set the OAuth app's redirect URI to `http://127.0.0.1:8787/auth/github/callback` (override with `ATC_GITHUB_REDIRECT_URI`).

### History

The sidebar's History badge reflects the number of in-memory recent jobs (default 50). Clicking it opens a list of past questions with status, timestamps, and the repos used. State is process-local and resets when the server stops; `GET /history` returns the same data as JSON.

## Configuration overrides

- `ATC_DEFAULT_MODEL`: overrides the default Codex model (`gpt-5.4-mini`)
- `ATC_DEFAULT_REASONING_EFFORT`: overrides the default reasoning effort (`low`)
- `ATC_CODEX_TIMEOUT_MS`: overrides the Codex execution timeout (default `300000`)
- `GH_TOKEN` / `GITHUB_TOKEN`: authenticates GitHub repo discovery; if they are unset, discovery can fall back to the current `gh` login instead
- `ATC_SERVER_HOST`: overrides the HTTP bind host (`127.0.0.1`)
- `ATC_SERVER_PORT`: overrides the HTTP bind port (`8787`)
- `ATC_SERVER_BODY_LIMIT_BYTES`: overrides the max HTTP request body size (`65536`)
- `ATC_SERVER_MAX_CONCURRENT_JOBS`: overrides the max concurrent HTTP jobs (`3`)
- `ATC_SERVER_JOB_RETENTION_MS`: overrides how long completed HTTP jobs stay in memory (`3600000`)
- `ATC_GITHUB_CLIENT_ID`, `ATC_GITHUB_CLIENT_SECRET`: enables GitHub sign-in in the web UI
- `ATC_GITHUB_REDIRECT_URI`: defaults to `http://127.0.0.1:8787/auth/github/callback`
- `ATC_SESSION_SECRET`: at least 16 characters; required for GitHub sign-in (signs the session cookie)

You can also override ask settings on the command line:

```bash
atc --audience codebase --model gpt-5.4 --reasoning-effort low "..."
```

For the HTTP server, the equivalent command-line overrides are:

```bash
atc-server --host 127.0.0.1 --port 8787
```

## Install locally

```bash
npm link
```

## Runtime

- Node.js 24 or newer

## Tests

```bash
npm test
npm run test:coverage
```

GitHub Actions CI runs `npm ci` and `npm test -- --coverage` on pull requests and pushes to `main`.

## Current limits

- automatic repo selection depends on a best-effort Codex pre-pass over repo metadata, with fallback to local heuristic scoring based on repo names, descriptions, routing metadata, and any repos pinned with `alwaysSelect`
- syncing assumes the managed clones can fast-forward cleanly
- the configured repo set is explicit and must be maintained in local config
- HTTP job state is in-memory only and is lost when the server process restarts
- HTTP repo sync coordination is per-process only; multi-process deployments need external coordination
