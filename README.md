# Archa

Archa is your personal code archaeologist. Ask your codebase how it behaves.

Archa has two adapters over the same repo-aware question-answering core:

- the `archa` CLI for local terminal use
- the `archa-server` HTTP server for async job-based integrations

Both adapters manage a configured set of repositories, keep them in sync, and use the local `codex exec` CLI to answer codebase questions across them.

The project is intentionally split in two:

- source code in this repo
- managed repo definitions in user config, not in Git

This keeps the tool reusable while still letting each installation decide which repos to manage.

Archa requires local `git` on `PATH` for repo sync and GitHub discovery, plus the local `codex` CLI on `PATH` and a logged-in Codex session for synthesis and curated discovery.

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
archa "How does this codebase behave?"
```

or

```bash
archa-server
```

When no config exists yet, Archa will prompt to initialize it and can continue directly into GitHub discovery from that flow. You do not need to run `archa config init` first unless you prefer to manage setup manually.

This project follows a simple layout:

- `src/cli/` for the CLI entrypoint, argument parsing, terminal rendering, and interactive setup UX
- `src/server/` for the server entrypoint, HTTP API, and built-in web UI
- `src/core/` for shared application logic such as config, discovery, repo sync, job execution, and Codex integration
- tests in `test/`
- coverage target: 80% statements and branches

## Configuration

By default, `archa` reads config from:

```text
~/.config/archa/config.json
```

You can override that path with:

```bash
export ARCHA_CONFIG_PATH=/path/to/config.json
```

The config file contains:

- `managedReposRoot`: where local clones live
- `repos`: the curated repo list, including URL, branch, description, generic `topics`, high-signal `classifications`, and optional aliases

Repo names and aliases must be unique case-insensitively. Aliases must be non-empty strings.
GitHub repos are always stored under an owner-scoped path inside `managedReposRoot`, such as `.../repos/leanish/nullability` or `.../repos/Nosto/playcart`, using the owner casing from GitHub.

Example using a few public `leanish` repos:

```json
{
  "managedReposRoot": "/Users/you/.local/share/archa/repos",
  "repos": [
    {
      "name": "sqs-codec",
      "url": "https://github.com/leanish/sqs-codec.git",
      "defaultBranch": "main",
      "description": "automatic compression+encoding for SQS Messages",
      "topics": ["aws-sqs", "aws-sdk-v2", "message-compression"],
      "classifications": ["library"],
      "aliases": [],
      "alwaysSelect": false
    },
    {
      "name": "java-conventions",
      "url": "https://github.com/leanish/java-conventions.git",
      "defaultBranch": "main",
      "description": "Shared Gradle conventions for Java projects",
      "topics": ["gradle-plugin", "build-conventions"],
      "classifications": ["library"],
      "aliases": [],
      "alwaysSelect": false
    },
    {
      "name": "archa",
      "url": "https://github.com/leanish/archa.git",
      "defaultBranch": "main",
      "description": "Archa is your personal code archaeologist. Ask your codebase how it behaves.",
      "topics": ["codex", "repo-selection", "developer-tools"],
      "classifications": ["internal", "backend", "cli"],
      "aliases": [],
      "alwaysSelect": false
    }
  ]
}
```

Repos may also set `"alwaysSelect": true` to stay in scope during automatic repo selection. This is useful for foundational repos that should always be available when Archa narrows to likely matches. If nothing scores positively, Archa still falls back to all configured repos.
`classifications` are handled separately from free-form `topics` and weighted more strongly during automatic repo selection for cues like `infra`, `library`, `internal`, `external`, and `microservice`. `external` is reserved for outward-facing applications or service surfaces; repos are not marked `external` just because they mention or integrate with GraphQL, REST, or APIs. Classifications are additive rather than exclusive, so a repo can carry multiple accurate roles when the evidence supports that.

Bootstrap an empty config:

```bash
archa config init
```

When `config init` creates a config with zero repos, it prints the next step:

```bash
archa config discover-github
```

That flow discovers repos with GitHub metadata plus curated descriptions, topics, and `classifications`. Discovery uses `GH_TOKEN` / `GITHUB_TOKEN` when available, and otherwise can fall back to a usable `gh` login. It can include private repos visible to that credential. When GitHub leaves descriptions or topics blank, Archa can fill them from README/source inspection. It keeps GitHub topics first, supplements them with a locally inferred topic set from repo descriptions or inspected repo content, and then runs a Codex cleanup pass over the draft metadata to improve precision.

Initialize config from an existing catalog file:

```bash
archa config init \
  --catalog /path/to/catalog.json \
  --managed-repos-root /Users/leandro.aguiar/.local/share/archa/repos
```

Discover repos and choose what to add or override. When `--owner` is omitted, Archa prompts on a TTY and otherwise defaults to `@accessible`:

```bash
archa config discover-github
```

Target a specific GitHub user or org explicitly:

```bash
archa config discover-github --owner leanish
```

To list all repos visible through your authenticated GitHub access across personal and organization scopes:

```bash
archa config discover-github --owner @accessible
```

While discovery runs, Archa prints progress updates so the command does not look stuck.

Use the same command to select additions or overrides from that owner into the active config:

```bash
archa config discover-github
```

When the command runs in a terminal, Archa prompts once with the combined list of new and already configured repos. If you did not pass `--owner`, that flow first prompts for a GitHub owner and accepts Enter for `@accessible`. Multi-owner discovery groups repos by owner for readability, and only falls back to owner-qualified names when repo names collide. If two GitHub repos would otherwise collide by plain name, Archa automatically uses an owner-qualified config name such as `nosto/nullability` so both can coexist. Managed checkouts are owner-scoped on disk for GitHub repos even when the configured name stays plain. Press Enter to add all new repos, or type names to customize the selection; a confirmation prompt avoids doing that silently. Anything you pick gets added or overridden as needed. For scripted use, pass `--owner`, `--add <names>`, and `--override <names>`, or use `*` to select all repos of that kind. Owner-qualified names such as `leanish/nullability` are accepted case-insensitively when you want to be explicit.

By default, GitHub discovery includes forks and skips archived or disabled repos. Use `--exclude-forks` to hide forks, and `--include-archived` to keep archived repos in scope. GitHub may also report some archived repos as disabled, so that flag can surface both. Discovery uses `GH_TOKEN` / `GITHUB_TOKEN` when available, or an existing `gh` login otherwise. Discovery includes private repos visible to that credential. The first pass is intentionally names-first: Archa lists the eligible repos so you can choose what to add or override without paying for per-repo topic lookups up front. After selection, Archa refines only the chosen subset: it fills blank descriptions or topics from README/source inspection when needed, derives additional topics with a size-aware topic budget, derives separate `classifications` like `infra`, `library`, `internal`, `external`, `frontend`, `backend`, and `microservice`, and then runs a Codex cleanup pass before saving the selected repos into config in one write. `external` is kept high-precision: it means the repo clearly exposes an outward-facing app or service surface, not merely that it mentions or consumes APIs. Repo names are handled separately during selection instead of being copied into `topics`. When a selected repo is already cloned under the managed repos root, discovery inspects that local checkout; otherwise it can shallow-clone the repo temporarily to inspect and curate metadata from source structure and README cues. Overrides update the configured repo's URL, default branch, description, topics, and classifications while preserving local-only fields such as aliases and `alwaysSelect`.

When either `archa` or `archa-server` starts with no `config.json` and stdin/stdout are attached to a TTY, Archa prompts to initialize the config instead of only failing with a command suggestion. If that new config still has zero repos, it can then prompt to continue directly into `discover-github`, ask for the GitHub owner, and resume the original command after discovery. Pressing Enter at that owner prompt uses `@accessible`, which discovers all repos visible through your authenticated GitHub access across personal and organization scopes. Outside that interactive CLI flow, `config init`, `archa-server` startup, repo-listing output, and the web UI empty state still surface `archa config discover-github` as the recovery path.

Print the active config path:

```bash
archa config path
```

## Usage

List the configured repos:

```bash
archa repos list
```

Clone or update all configured repos:

```bash
archa repos sync
```

Clone or update only a few repos:

```bash
archa repos sync sqs-codec,java-conventions
```

Ask a question. By default `archa` will:

1. choose likely repos from the configured repo list, while keeping any repos marked with `"alwaysSelect": true` in scope
   If nothing scores positively, all configured repos are used.
2. sync them to the latest tracked trunk tip
3. run `codex exec` with `gpt-5.4` and `low` reasoning effort

By default, answers target a general engineering reader. When the reader can inspect the repositories directly, use `--audience codebase` to get a more implementation-oriented answer.

While it runs, `archa` keeps progress reporting high-level, including a heartbeat every 10 seconds during long Codex runs. Raw nested Codex logs stay hidden unless the command fails.

Managed repos are synced against their configured `defaultBranch`. Discovery’s temporary inspection clones are shallow. Managed repo sync uses normal long-lived checkouts; if a managed repo happens to be shallow, Archa first runs `git fetch --unshallow` before the normal fast-forward update flow.

A few example questions against public `leanish` repos:

```bash
archa "How does sqs-codec encode compression and checksum metadata in x-codec-meta?"
archa "How does java-conventions infer leanish.conventions.basePackage when the property is missing?"
archa "How does archa choose the Codex working directory when one repo matches versus several?"
```

Force a specific repo set:

```bash
archa --repo sqs-codec "What does skipCompressionWhenLarger do when compression would make the payload larger?"
```

When only one repo is selected, Codex runs with that repo as its working directory. Otherwise it runs from the configured managed repos workspace root.

Read the question from a file:

```bash
archa --repo java-conventions --question-file /path/to/question.txt
```

Switch the answer audience when you want repo-level implementation detail:

```bash
archa --repo archa --audience codebase "Which modules shape the Codex prompt and pick the working directory?"
```

Skip repo sync first:

```bash
archa --repo archa --no-sync "How does codex-runner emit heartbeats and capture the final answer?"
```

For repeated questions against repos that are already up to date, prefer `--no-sync` to avoid paying the clone/pull cost on every run.

Show only the selected repos and sync results, even if syncing fails:

```bash
archa --repo sqs-codec,java-conventions --no-synthesis "Which repo defines the default coverage threshold, and which repo consumes it?"
```

## HTTP server

Start the optional HTTP adapter with explicit flags:

```bash
archa-server --host 127.0.0.1 --port 8787
```

You can also configure the bind host and port with environment variables:

```bash
ARCHA_SERVER_HOST=127.0.0.1 ARCHA_SERVER_PORT=8787 archa-server
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
    "question": "How does archa choose the Codex working directory when one repo matches versus several?",
    "repoNames": ["archa"]
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

When `model` or `reasoningEffort` are omitted from the HTTP request, the server uses the same defaults as the CLI: `gpt-5.4` and `low`.
When `audience` is omitted, the server defaults to `general`. Use `codebase` when the reader can inspect the managed repos directly and wants file- and symbol-level detail.

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

When the HTTP server shuts down through its returned handle, queued jobs fail fast and running jobs are allowed to finish before the manager is cleared. `archa-server` wires `SIGTERM` and `SIGINT` to that shutdown path, and a second signal forces an immediate exit.

### Web UI

Open `http://127.0.0.1:8787` in a browser to use the built-in web UI. The UI streams job status updates in real time using server-sent events and loads the configured repo catalog so the repo filter can be selected from a searchable multi-select instead of typed manually.

Advanced web UI controls are hidden by default and only shown when the page is opened with `?admin=true`, for example `http://127.0.0.1:8787/?admin=true`. In admin mode, you can choose the answer audience, model, and reasoning effort. The default audience is `general`.

Programmatic clients that do not send `Accept: text/html` continue to receive the JSON endpoint listing at `GET /`.

## Configuration overrides

- `ARCHA_DEFAULT_MODEL`: overrides the default Codex model (`gpt-5.4`)
- `ARCHA_DEFAULT_REASONING_EFFORT`: overrides the default reasoning effort (`low`)
- `ARCHA_CODEX_TIMEOUT_MS`: overrides the Codex execution timeout (default `300000`)
- `GH_TOKEN` / `GITHUB_TOKEN`: authenticates GitHub repo discovery; if they are unset, discovery can fall back to the current `gh` login instead
- `ARCHA_SERVER_HOST`: overrides the HTTP bind host (`127.0.0.1`)
- `ARCHA_SERVER_PORT`: overrides the HTTP bind port (`8787`)
- `ARCHA_SERVER_BODY_LIMIT_BYTES`: overrides the max HTTP request body size (`65536`)
- `ARCHA_SERVER_MAX_CONCURRENT_JOBS`: overrides the max concurrent HTTP jobs (`3`)
- `ARCHA_SERVER_JOB_RETENTION_MS`: overrides how long completed HTTP jobs stay in memory (`3600000`)

You can also override ask settings on the command line:

```bash
archa --audience codebase --model gpt-5.4 --reasoning-effort low "..."
```

For the HTTP server, the equivalent command-line overrides are:

```bash
archa-server --host 127.0.0.1 --port 8787
```

Legacy aliases `ARCHA_MODEL` and `ARCHA_REASONING_EFFORT` are still accepted for compatibility, but the `ARCHA_DEFAULT_*` names are preferred.

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

GitHub Actions CI runs `npm ci` and `npm test -- --coverage` on pull requests and pushes to `main` and `improvement/**`.

## Current limits

- automatic repo selection is heuristic, based on repo names, descriptions, topics, separately weighted classifications, and any repos pinned with `alwaysSelect`
- syncing assumes the managed clones can fast-forward cleanly
- the configured repo set is explicit and must be maintained in local config
- HTTP job state is in-memory only and is lost when the server process restarts
- HTTP repo sync coordination is per-process only; multi-process deployments need external coordination
