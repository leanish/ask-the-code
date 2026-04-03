# HTTP API

The optional `archa-server` adapter exposes the repo-aware question-answering flow as async HTTP jobs.

## Endpoints

### `GET /health`

Returns:

```json
{
  "status": "ok"
}
```

### `POST /ask`

Alias of `POST /jobs`.

### `POST /jobs`

Creates a new async job.

Request body:

```json
{
  "question": "How does archa choose the Codex working directory when one repo matches versus several?",
  "repoNames": ["archa"],
  "model": "gpt-5.4",
  "reasoningEffort": "low",
  "noSync": false,
  "noSynthesis": false
}
```

Rules:

- `question` is required and must be a non-empty string
- `repoNames` may be an array of repo names or a comma-separated string
- `repos` is accepted as an alias of `repoNames`
- `repoNames` and `repos` must not be provided together
- `model` and `reasoningEffort` are optional strings
- `noSync` and `noSynthesis` are optional booleans

Response:

```json
{
  "id": "job-id",
  "status": "queued",
  "request": {
    "question": "How does archa choose the Codex working directory when one repo matches versus several?",
    "repoNames": ["archa"],
    "model": null,
    "reasoningEffort": null,
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
- job execution concurrency is bounded per process
- repo sync coordination is per process and deduplicates overlapping syncs for the same repo directory
