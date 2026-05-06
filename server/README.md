# LUE Agent Server

## Postman

Use the local server base URL:

```text
http://localhost:3000
```

### Routes

`GET /api/health`

- No auth required.
- Response includes service status, Pinecone connectivity, embedding cache size, retrieval settings, and rate-limit settings.
- Every response includes the `X-Request-ID` header.

`GET /api/health/auth`

- Requires `Authorization: Bearer <base64-json-session-token>`.
- Echoes the parsed session so role tokens can be verified quickly in Postman.

`POST /api/ingest`

- No auth required in the current phase.
- `Content-Type: application/json`
- Body:

```json
{
  "schoolId": "school_001",
  "documents": [
    {
      "id": "notice_sports_day",
      "content": "Annual Sports Day will be held on May 10th, 2026 at the school grounds.",
      "metadata": {
        "school_id": "school_001",
        "data_category": "general",
        "access_roles": ["general"],
        "entity_type": "notice",
        "content_summary": "Sports Day announcement",
        "created_at": 1746374400000
      }
    }
  ]
}
```

- Success response shape:

```json
{
  "success": true,
  "ingested": 1,
  "chunks_created": 1,
  "latency_ms": 623
}
```

- Validation failure response shape:

```json
{
  "error": "Validation failed",
  "issues": [
    {
      "path": "documents.0.metadata.data_category",
      "message": "Invalid option: expected one of \"general\"|\"academic\"|\"attendance\"|\"financial\"|\"personal\""
    }
  ]
}
```

`POST /api/query`

- Requires `Authorization: Bearer <base64-json-session-token>`.
- `Content-Type: application/json`
- Body:

```json
{
  "query": "When is Sports Day?",
  "top_k": 5
}
```

- Response is an SSE stream. Typical events:

```text
data: {"text":"Hi Arjun! The Annual Sports Day will be held on May 10th, 2026."}

data: {"done":true,"latency_ms":1819,"chunks_used":1,"embedding_cached":true,"retrieval_latency_ms":320,"embedding_latency_ms":0}
```

- Failure events stay inside SSE:

```text
data: {"error":"Cloudflare embedding API failed: status=401 body=..."}
```

### Example Tokens

`admin`

```text
eyJzY2hvb2xfaWQiOiJzY2hvb2xfMDAxIiwidXNlcl9pZCI6ImFkbWluXzAwMSIsInJvbGUiOiJhZG1pbiIsIm5hbWUiOiJQcmluY2lwYWwgU2hhcm1hIn0=
```

`teacher`

```text
eyJzY2hvb2xfaWQiOiJzY2hvb2xfMDAxIiwidXNlcl9pZCI6InRlYWNoZXJfMDAxIiwicm9sZSI6InRlYWNoZXIiLCJuYW1lIjoiTXMuIE1lZXJhIEl5ZXIiLCJ0ZWFjaGVyX2lkIjoidGVhY2hlcl8wMDEiLCJjbGFzc19pZHMiOlsiY2xhc3NfNmEiLCJjbGFzc183YiJdfQ==
```

`parent`

```text
eyJzY2hvb2xfaWQiOiJzY2hvb2xfMDAxIiwidXNlcl9pZCI6InBhcmVudF8wMDEiLCJyb2xlIjoicGFyZW50IiwibmFtZSI6Ik1yLiBSLiBTaGFybWEiLCJwYXJlbnRfaWQiOiJwYXJlbnRfMDAxIiwic3R1ZGVudF9pZHMiOlsic3R1ZGVudF8wMDEiXX0=
```

`student`

```text
eyJzY2hvb2xfaWQiOiJzY2hvb2xfMDAxIiwidXNlcl9pZCI6InN0dWRlbnRfMDAxIiwicm9sZSI6InN0dWRlbnQiLCJuYW1lIjoiQXJqdW4gU2hhcm1hIiwic3R1ZGVudF9pZCI6InN0dWRlbnRfMDAxIiwiY2xhc3NfaWRzIjpbImNsYXNzXzZhIl19
```

### Postman Checks

- `GET /api/health` should return `status: "ok"` and an `X-Request-ID` header.
- `GET /api/health/auth` should echo the parsed token session.
- `POST /api/ingest` should ingest `data/seed.json` successfully.
- Student asking `What are Priya's fees?` should receive an `I don't have that information...` answer.
- Student asking `When is Sports Day?` twice should show `embedding_cached: false` on the first final event and `embedding_cached: true` on the second.
