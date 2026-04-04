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

This project follows a simple layout:

- source in `src/`
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
- `repos`: the curated repo list, including URL, branch, description, topics, and optional aliases

Example using a few public `leanish` repos:

```json
{
  "managedReposRoot": "/Users/you/.local/share/archa/repos",
  "repos": [
    {
      "name": "sqs-codec",
      "url": "https://github.com/leanish/sqs-codec.git",
      "defaultBranch": "main",
      "description": "SQS execution interceptor that compresses message bodies and stores codec metadata",
      "topics": ["aws", "sqs", "compression", "checksum"],
      "aliases": ["codec"]
    },
    {
      "name": "java-conventions",
      "url": "https://github.com/leanish/java-conventions.git",
      "defaultBranch": "main",
      "description": "Shared Gradle conventions for JDK-based projects",
      "topics": ["gradle", "java", "jacoco", "checkstyle"],
      "aliases": ["conventions"]
    },
    {
      "name": "archa",
      "url": "https://github.com/leanish/archa.git",
      "defaultBranch": "main",
      "description": "Repo-aware CLI for engineering Q&A with local Codex",
      "topics": ["cli", "codex", "qa"],
      "aliases": ["self"]
    }
  ]
}
```

Bootstrap an empty config:

```bash
archa config init
```

Initialize config from an existing catalog file:

```bash
archa config init \
  --catalog /path/to/catalog.json \
  --managed-repos-root /Users/leandro.aguiar/.local/share/archa/repos
```

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

1. choose likely repos from the configured repo list
2. clone or pull them
3. run `codex exec` with `gpt-5.4` and `low` reasoning effort

By default, answers target a general engineering reader. When the reader can inspect the repositories directly, use `--audience codebase` to get a more implementation-oriented answer.

While it runs, `archa` keeps progress reporting high-level, including a heartbeat every 10 seconds during long Codex runs. Raw nested Codex logs stay hidden unless the command fails.

Managed repos are synced only against their default trunk branch, currently limited to `main` or `master`.
If no repo scores positively for a question, `archa` falls back to all configured repos.

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

The server exposes async jobs over HTTP. Submit a new question with `POST /ask`, then use the returned `/jobs/:id` and `/jobs/:id/events` links to poll or stream progress.

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

### Web UI

Open `http://127.0.0.1:8787` in a browser to use the built-in web UI. The UI streams job status updates in real time using server-sent events and loads the configured repo catalog so the repo filter can be selected from a searchable multi-select instead of typed manually.

Advanced web UI controls are hidden by default and only shown when the page is opened with `?admin=true`, for example `http://127.0.0.1:8787/?admin=true`. In admin mode, you can choose the answer audience, model, and reasoning effort. The default audience is `general`.

Programmatic clients that do not send `Accept: text/html` continue to receive the JSON endpoint listing at `GET /`.

## Configuration overrides

- `ARCHA_DEFAULT_MODEL`: overrides the default Codex model (`gpt-5.4`)
- `ARCHA_DEFAULT_REASONING_EFFORT`: overrides the default reasoning effort (`low`)
- `ARCHA_CODEX_TIMEOUT_MS`: overrides the Codex execution timeout (default `300000`)
- `ARCHA_SERVER_HOST`: overrides the HTTP bind host (`127.0.0.1`)
- `ARCHA_SERVER_PORT`: overrides the HTTP bind port (`8787`)
- `ARCHA_SERVER_BODY_LIMIT_BYTES`: overrides the max HTTP request body size (`65536`)
- `ARCHA_SERVER_MAX_CONCURRENT_JOBS`: overrides the max concurrent HTTP jobs (`1`)
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

- repo selection is still heuristic, based on repo names, descriptions, and topics
- syncing assumes the managed clones can fast-forward cleanly
- the configured repo set is explicit and must be maintained in local config
- HTTP job state is in-memory only and is lost when the server process restarts
- HTTP repo sync coordination is per-process only; multi-process deployments need external coordination
