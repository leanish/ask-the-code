# HTTP API

The optional `atc-server` adapter exposes the repo-aware question-answering flow as async HTTP jobs. New jobs are created with `POST /ask`, then read back through `GET /jobs/:id` and `GET /jobs/:id/events`.

## Endpoints

### `GET /`

Always serves the built-in web UI HTML page. Mode is selected from the `?mode=` query (highest priority — also writes the `atc_mode` cookie) and falls back to the `atc_mode` cookie, defaulting to `simple`. Programmatic clients should use the dedicated JSON endpoints below.

### `GET /health`

Returns the server status along with job counts by state:

```json
{
  "status": "ok",
  "jobs": {
    "queued": 0,
    "running": 0,
    "completed": 0,
    "failed": 0
  }
}
```

Notes:

- `jobs` is `null` when the server is using a custom job manager that does not expose stats
- `completed` and `failed` reflect only the jobs still retained in memory, not cumulative historical totals
- those counts reset after the job retention window expires and when the server process restarts

### `GET /repos`

Returns the configured repo catalog for the built-in web UI repo picker.

Response:

```json
{
  "repos": [
    {
      "name": "ask-the-code",
      "defaultBranch": "main",
      "description": "Repo-aware CLI for engineering Q&A with local Codex",
      "aliases": ["self"]
    }
  ],
  "setupHint": null
}
```

Notes:

- `setupHint` is `null` during normal operation
- when the configured repo list is empty, `setupHint` contains a suggested `discover-github` command for bootstrapping config

### `POST /ask`

Creates a new async job.

Legacy note:

- `POST /jobs` is no longer accepted; clients must use `POST /ask`

Request body:

```json
{
  "question": "How does ask-the-code choose the Codex working directory when one repo matches versus several?",
  "repoNames": ["ask-the-code"],
  "audience": "general",
  "model": "gpt-5.4-mini",
  "reasoningEffort": "low",
  "selectionMode": "single",
  "selectionShadowCompare": false,
  "noSync": false,
  "noSynthesis": false
}
```

Rules:

- `question` is required and must be a non-empty string
- `repoNames` may be an array of repo names or a comma-separated string
- `repos` is accepted as an alias of `repoNames`
- `repoNames` and `repos` must not be provided together
- `audience` is optional and must be one of `general` or `codebase`
- omitted `audience` defaults to `general`
- `model` and `reasoningEffort` are optional strings
- omitted `model` and `reasoningEffort` use the same execution defaults as the CLI: `gpt-5.4-mini` and `low`
- `selectionMode` is optional and must be one of `single` or `cascade`
- omitted `selectionMode` defaults to `single`
- `selectionShadowCompare` is an optional boolean; when `true`, the server keeps background `none`, `low`, and `high` repo-selector runs for comparison diagnostics while the main ask continues
- `noSync` and `noSynthesis` are optional booleans

Response:

```json
{
  "id": "job-id",
  "status": "queued",
  "request": {
    "question": "How does ask-the-code choose the Codex working directory when one repo matches versus several?",
    "repoNames": ["ask-the-code"],
    "audience": "general",
    "model": null,
    "reasoningEffort": null,
    "selectionMode": "single",
    "selectionShadowCompare": false,
    "noSync": false,
    "noSynthesis": false
  },
  "createdAt": "2026-04-03T11:11:11.111Z",
  "startedAt": null,
  "finishedAt": null,
  "error": null,
  "result": null,
  "events": [
    {
      "sequence": 1,
      "type": "queued",
      "message": "Job queued.",
      "timestamp": "2026-04-03T11:11:11.111Z"
    }
  ],
  "links": {
    "self": "/jobs/job-id",
    "events": "/jobs/job-id/events"
  }
}
```

### `GET /jobs/:id`

Returns the latest full job snapshot, including:

- current status
- original request
- event history
- terminal result or error

When automatic repo selection runs, terminal ask results also include a `selection` summary describing the final selector source and any completed selector runs.

Statuses:

- `queued`
- `running`
- `completed`
- `failed`

### `GET /jobs/:id/events`

Returns a server-sent event stream.

Behavior:

- the stream starts with a `snapshot` event containing the current full job snapshot
- if the job is already terminal, the server immediately sends a terminal event and closes the stream
- otherwise the server streams live job events until `completed` or `failed`

Event types:

- `snapshot`
- `started`
- `status`
- `completed`
- `failed`

## Operational characteristics

- job state is in-memory only
- completed jobs expire after a retention timeout
- job execution concurrency is bounded per process and defaults to 3 concurrent jobs
- repo sync coordination is per process and deduplicates overlapping syncs for the same repo directory
- the built-in web UI lists configured repos via `GET /repos` for the All Repositories view, and exposes audience/model/reasoning/selection controls only in Expert mode (`?mode=expert` or via the in-page toggle, persisted in the `atc_mode` cookie); Simple mode submits only the question and lets the server pick defaults
- `GET /` always returns HTML; the JSON endpoints listed above are the programmatic API
- both `GET` and `POST /jobs` are removed; `POST /ask` replaces them and `POST /jobs` returns 410 Gone with an explanatory body
