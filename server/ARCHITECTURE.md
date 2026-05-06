# LUE Agent — Complete Architecture & Implementation Guide

> **Note to Codex:** This is a first-draft architecture document. The design decisions,
> code snippets, and structural choices presented here are a strong starting point — but
> you have full authority to improve, refactor, and optimise anything that doesn't meet
> production standards. The goal is a clean, scalable, well-typed Node.js + TypeScript
> backend. Always favour clarity, correctness, and maintainability over strictly following
> this draft.

---

## PART 0 — What Is LUE Agent? (Read This First)

### The Platform Context

Riversand Labs builds a product called **LUE (Light Up Education)** — a school management
platform sold to schools and colleges across India. LUE is essentially the operating system
of a school. Every entity in a school's ecosystem lives inside it: students, teachers,
parents, administrators, class schedules, syllabi, homework assignments, fee records,
attendance data, hostel information, and transport details.

The platform is divided into 12 modules across 6 sections:

- **Education Embedded AI** — class setup, timetable generation, AI-powered homework
  generation, examination engine (hall tickets, virtual exam halls)
- **Partner Platform** — vendor badge system for extracurricular activity partners,
  smart canteen with digital wallet and subscription plans
- **Smart School Admin** — self-service admission portal (Razorpay payments, interview
  scheduling, real-time status tracking), admin management (fee tracking, financial
  reporting, attendance reports)
- **Personalised Personas** — four distinct dashboards for Admin, Teacher, Parent, and
  Student — each surfacing only what is relevant to that role
- **IoT & AI Integration** — live classroom updates, bus tracking, parent exam score
  notifications, smart building management
- **Beyond Education** — AI-powered career counselling, online library, hostel room
  allocation, hostel fee billing

The platform has a real dashboard (built in React) deployed at customer schools today.
The admin dashboard shows live data: total students, teacher counts, fee collection
status, leave overviews, and a notice board. The sidebar reveals the full data depth:
Admissions, Students, Parents, Guardians, Teachers, Classes, Sections, Subjects,
Timetable, Homework, Syllabus, Examinations, Fees, Library, Hostel, Transport, and more.

### The Problem LUE Agent Is Solving

The problem with any data-rich management platform is that **finding specific information
requires navigating menus, running reports, and switching between modules.** A parent who
wants to check their child's attendance has to log in, navigate to the attendance section,
find their child, select the month, and read the report. A teacher checking which students
haven't submitted homework has to cross-reference multiple screens.

LUE Agent gives every user — regardless of their role — a **single conversational
interface** where they can ask natural language questions and get immediate, accurate,
context-aware answers drawn from the school's live data.

The agent also already exists in a partial form in the product (the "LUE agent" search bar
visible on the platform homepage, supporting Tamil, English, and Hindi). Our job is to
build the backend that powers it correctly — at scale, with proper access control, and
without data leakage between users or schools.

### The Core Technical Challenge

The fundamental challenge is this: **standard RAG (Retrieval Augmented Generation) is
inherently single-tenant.** A typical RAG system embeds all documents, stores them in one
vector collection, and retrieves the top-K most semantically similar chunks to any query.
There is no concept of ownership, role, or access control built into the retrieval process.

For a multi-school platform where School A must never see School B's data, and where a
student must never see another student's fee records, naive RAG is architecturally broken.

We need a retrieval system where:
1. The search space is **physically isolated per school** — namespace-level isolation in Pinecone
2. Within a school, **only documents the requesting user is authorised to see** are ever fetched — metadata filter applied inside the vector query, not after it
3. The LLM receives only clean, authorised context and is shaped by a **role-aware system prompt** that controls both content and tone of its response

This architecture satisfies all three requirements simultaneously.

### What LUE Agent Can Do (Capabilities)

- Answer natural language questions in English, Hindi, and Tamil
- Return role-scoped answers — the same question asked by four different roles gives four different (all correct, all safe) responses
- Stream responses token by token so users see answers in under 800ms to first word
- Handle 1000+ concurrent users through embedding caching and Pinecone's serverless scaling
- Ingest school data (notices, homework, fees, attendance, syllabus, timetables) and make it queryable within seconds of ingestion

---

## PART 1 — System Architecture Overview

### High-Level Request Flow

```
User types: "What is my math homework due date?"
Session:    { role: "student", student_id: "s001", class_id: "class_6a", school_id: "school_001" }

[1] POST /api/query arrives at Express server
       │
       ▼
[2] sessionParser middleware
    Decodes Authorization header (Base64 JSON → SessionContext object)
    Validates: school_id, role, user_id, and role-specific fields (class_ids, student_id, etc.)
    Attaches validated session to req.session
    Returns 401 immediately if anything is invalid
       │
       ▼
[3] FilterBuilder.build(session)
    Pure function — no async, no side effects, fully unit-testable
    Constructs Pinecone metadata filter from session role and relationships
    For student role with student_id="s001":
    {
      $or: [
        { access_roles: { $in: ["general"] } },
        { $and: [
            { access_roles: { $in: ["student"] } },
            { student_id: { $eq: "s001" } }
          ]
        }
      ]
    }
       │
       ▼
[4] EmbeddingService.embedQuery(query)
    Normalize query: lowercase + trim
    Compute SHA-256 hash of normalized query → cache key
    Check in-memory Map cache:
      HIT  → return cached vector (0ms, no API call)
      MISS → POST to Cloudflare Workers AI (~300ms)
             Store result in cache with 1-hour TTL
    Returns: { vector: number[], cached: boolean, latency_ms: number }
       │
       ▼
[5] PineconeService.queryVectors(school_id, vector, filter, top_k=5)
    Target namespace: "school_001" (physically isolated per school)
    Apply filter from Step 3 inside the Pinecone query
    Unauthorized chunks are NEVER fetched — not even to the app server
Filter out results with score < RELEVANCE_THRESHOLD (default 0.65)
If a chunk passes the threshold, adjacent sibling chunks from the same original document
that are already present in the Pinecone result set may also be retained to avoid
losing fields split across chunk boundaries
    Returns: { chunks: RetrievedChunk[], latency_ms: number }
       │
       ▼
[6] PromptBuilder.build(session, query, chunks)
    Builds role-aware system prompt:
      "You are LUE. You are speaking to Arjun, a student in Class 6A.
       Answer ONLY from the provided context. Never reveal other students' data."
    Builds user message: [formatted context chunks] + [original query]
       │
       ▼
[7] LLMService.streamResponse(systemPrompt, userMessage, res, ...)
    Sets SSE headers: Content-Type: text/event-stream
    Calls Gemini via OpenAI-compatible API with stream: true
    Uses OpenAI SDK pointed at: https://generativelanguage.googleapis.com/v1beta/openai/
    Pipes each delta token to client: data: {"text":"..."}\n\n
    On completion: data: {"done":true,"latency_ms":847,"chunks_used":2,...}\n\n
       │
       ▼
[8] requestLogger logs full timing breakdown to console
    format: [LUE] method=POST path=/api/query status=200 latency=847ms role=student school=school_001
```

### Latency Budget (Design Target Per Step)

| Step | Operation | Target |
|------|-----------|--------|
| 1-3 | Parse + validate + build filter | ~0ms |
| 4 | Embedding (cache HIT) | ~0ms |
| 4 | Embedding (cache MISS) | 200–400ms |
| 5 | Pinecone retrieval | 50–100ms |
| 6 | Prompt construction | ~0ms |
| 7 | Time to first Gemini token | 300–600ms |
| **Total** | **Time to first word (cache miss)** | **< 800ms** |
| **Total** | **Complete response** | **< 3000ms** |

---

## PART 2 — Data Model & Metadata Schema

### Why Metadata Design Is the Foundation of Everything

Every vector stored in Pinecone carries two things: a 768-dimensional float array (the
semantic representation of the text) and a metadata object (structured key-value pairs
about what the text contains and who can see it). The metadata is what makes role-based
filtering possible. If the metadata schema is inconsistent, the access control breaks.

**Every vector stored in Pinecone must conform to this schema exactly:**

```typescript
// src/types/index.ts

export type UserRole = 'admin' | 'teacher' | 'parent' | 'student';

export type DataCategory =
  | 'general'     // Notices, events, announcements — ALL roles can see
  | 'academic'    // Syllabus, homework, grades — teacher + student + admin
  | 'attendance'  // Attendance records — teacher + admin + parent (own child) + student (self)
  | 'financial'   // Fees, payments — admin + parent (own child) ONLY
  | 'personal';   // Student PII (address, medical, Aadhaar) — admin ONLY

export interface DocumentMetadata {
  school_id: string;           // Which school owns this record
  data_category: DataCategory; // Determines base access tier
  access_roles: string[];      // Explicit role list: ["admin","teacher"] or ["general"]
  entity_type: string;         // "notice"|"homework"|"fee"|"attendance"|"syllabus"|"timetable"|...
  content_summary: string;     // Short label for debugging and logging

  // Scoping fields — narrow access further within the allowed roles
  // If student_id is set, only that student (and their authorised parent/teacher/admin) can see it
  student_id?: string;
  class_id?: string;
  teacher_id?: string;

  created_at: number;          // Unix timestamp ms
}
```

### Access Role Categories — Plain English Explanation

`"general"` — The content is visible to every authenticated user in the school regardless
of role. School-wide notices, event announcements, general timetables.

`["teacher"]` with `class_id` — Only teachers whose `class_ids` array includes this
`class_id` can retrieve it. A Math teacher for Class 6A cannot see homework records for
Class 7B even though they're both teachers in the same school.

`["student"]` with `student_id` — Only the specific student whose `student_id` matches can
retrieve their own records. Student A cannot see Student B's grades or attendance.

`["parent"]` with `student_id` — Only the parent whose `student_ids` array includes that
`student_id` can retrieve the record. A parent of Student A cannot query Student B's fees.

`["admin"]` — Only the school admin. Student PII, sensitive financial summaries,
disciplinary records fall here.

---

## PART 3 — Session Context & Authentication

### Session Design Philosophy

Authentication in Phase 1 uses a simple mechanism: the client sends a Base64-encoded JSON
object as a Bearer token. This is **not production-secure** — it cannot be verified as
tamper-proof. Its value in the current phase is letting us test every role scenario from
Postman without setting up OAuth infrastructure.

**The production upgrade path is simple:** replace the Base64 decode step with
`jsonwebtoken.verify(token, SECRET_KEY)`. The `SessionContext` interface stays 100%
identical. Only the parsing changes in `sessionParser.ts`.

```typescript
// src/types/index.ts

export interface SessionContext {
  school_id: string;      // Which school namespace to query in Pinecone
  user_id: string;        // Unique user ID
  role: UserRole;         // Determines which filter function is called
  name: string;           // Used in system prompt: "You are speaking to Arjun..."

  // Role-specific fields — validated per role in sessionParser
  teacher_id?: string;
  class_ids?: string[];   // Required for role="teacher" — which classes they teach

  student_id?: string;    // Required for role="student" — their own ID

  parent_id?: string;
  student_ids?: string[]; // Required for role="parent" — their children's IDs
}
```

### Session Parser Middleware

```typescript
// src/middleware/sessionParser.ts (first draft — Codex may improve)

export function sessionParser(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or malformed Authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const raw = JSON.parse(decoded) as Record<string, unknown>;

    req.session = validateSession(raw); // throws descriptively if anything is missing
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid session token';
    res.status(401).json({ error: `Session parse error: ${message}` });
  }
}
```

### Generating Test Tokens (Paste Into Node.js REPL)

```javascript
// Admin
Buffer.from(JSON.stringify({
  school_id: "school_001", user_id: "admin_001",
  role: "admin", name: "Principal Sharma"
})).toString('base64')

// Teacher (teaches Class 6A and 7B)
Buffer.from(JSON.stringify({
  school_id: "school_001", user_id: "teacher_001",
  role: "teacher", name: "Ms. Meera Iyer",
  teacher_id: "teacher_001", class_ids: ["class_6a", "class_7b"]
})).toString('base64')

// Parent (parent of Arjun = student_001)
Buffer.from(JSON.stringify({
  school_id: "school_001", user_id: "parent_001",
  role: "parent", name: "Mr. R. Sharma",
  parent_id: "parent_001", student_ids: ["student_001"]
})).toString('base64')

// Student (Arjun, Class 6A)
Buffer.from(JSON.stringify({
  school_id: "school_001", user_id: "student_001",
  role: "student", name: "Arjun Sharma",
  student_id: "student_001", class_ids: ["class_6a"]
})).toString('base64')
```

---

## PART 4 — Pinecone: Namespace Strategy & Vector Storage

### Why Namespace-Per-School

Three options exist. Only one is correct.

**Option A — One Pinecone index per school:** Pinecone charges per index on paid plans.
A SaaS serving 500 schools cannot maintain 500 indexes. Eliminated on cost grounds.

**Option B — One flat index, filter by `school_id` metadata:** Every query searches ALL
schools' data. A single bug in filter logic could expose School A's data to School B.
The security boundary lives in application code — the most dangerous place for it. Eliminated.

**Option C — One index, one namespace per school:** Pinecone namespaces are free and
unlimited. A query to `namespace("school_001")` physically cannot return results from
`namespace("school_002")` — enforced at Pinecone infrastructure level, not our code.
Even if role filtering has a bug, cross-school leakage is structurally impossible. **Chosen.**

```
Pinecone Index: "lue-agent" (dimension=768, metric=cosine)
  └── Namespace: "school_001"  ← Delhi Public School
       ├── notice_sports_day_chunk_0      [access_roles: ["general"]]
       ├── homework_6a_math_chunk_0       [access_roles: ["teacher","student"], class_id: "class_6a"]
       ├── fee_student_001_chunk_0        [access_roles: ["parent","admin"], student_id: "student_001"]
       └── profile_student_001_chunk_0   [access_roles: ["admin"], student_id: "student_001"]
  └── Namespace: "school_002"  ← Ryan International (completely isolated)
```

### Upsert Structure

The text content of each chunk is stored as `metadata["content"]`. This avoids a secondary
database lookup when reconstructing retrieved chunks — Pinecone returns both the vector
similarity score and the raw text in a single query response.

```typescript
// src/services/pinecone.service.ts (first draft)

export async function upsertVectors(
  schoolId: string,
  vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }>
): Promise<void> {
  const index = getPineconeIndex();
  const ns = index.namespace(`school_${schoolId}`);

  const BATCH_SIZE = 100; // Pinecone recommended batch size
  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    await ns.upsert(vectors.slice(i, i + BATCH_SIZE));
  }
}

export async function queryVectors(
  schoolId: string,
  vector: number[],
  filter: Record<string, unknown>,
  topK: number
): Promise<{ chunks: RetrievedChunk[]; latency_ms: number }> {
  const start = Date.now();
  const ns = getPineconeIndex().namespace(`school_${schoolId}`);

  const response = await ns.query({
    vector,
    topK,
    includeMetadata: true,
    // Only apply filter if non-empty — admin uses {} for unrestricted access
    ...(Object.keys(filter).length > 0 ? { filter } : {}),
  });

  const chunks = (response.matches ?? [])
    .filter(m => (m.score ?? 0) >= config.retrieval.relevanceThreshold)
    .map(m => ({
      id: m.id,
      content: m.metadata?.content as string ?? '',
      metadata: m.metadata as unknown as DocumentMetadata,
      score: m.score ?? 0,
    }))
    .filter(c => c.content.length > 0);

  return { chunks, latency_ms: Date.now() - start };
}
```

---

## PART 5 — The Filter Builder (Security Core)

### Architecture of the Filter Builder

The filter builder is the most security-critical piece of code in the entire system. It
translates a `SessionContext` into a Pinecone metadata filter object. This function is
called once per request, its output goes directly to Pinecone, and it determines what
data is physically retrievable for that user.

It is a **pure function** — no async, no side effects, no external calls. Given the same
session, it always produces the same filter. This makes it trivially unit-testable.
Incorrect filter logic is a data breach. Write unit tests for every case.

```typescript
// src/utils/filterBuilder.ts (first draft — write thorough unit tests for this file)

export function buildPineconeFilter(session: SessionContext): Record<string, unknown> {
  switch (session.role) {

    case 'admin':
      // Empty filter = no restrictions within the school namespace.
      // The namespace already provides school-level isolation.
      return {};

    case 'teacher':
      // Teacher sees: general content + class-scoped content for THEIR assigned classes.
      // Teacher A teaching class_6a CANNOT see class_8c homework, even in the same school.
      return {
        $or: [
          { access_roles: { $in: ['general'] } },
          {
            $and: [
              { access_roles: { $in: ['teacher'] } },
              { class_id: { $in: session.class_ids ?? [] } },
            ],
          },
        ],
      };

    case 'parent':
      // Parent sees: general content + data scoped to THEIR children's student IDs only.
      // parent_001 cannot see student_002's fee records even if they ask explicitly.
      return {
        $or: [
          { access_roles: { $in: ['general'] } },
          {
            $and: [
              { access_roles: { $in: ['parent'] } },
              { student_id: { $in: session.student_ids ?? [] } },
            ],
          },
        ],
      };

    case 'student':
      // Student sees: general content + data scoped to THEIR OWN student_id only.
      // student_001 asking "what are Priya's fees?" returns zero results — not an error,
      // just no matching chunks. The LLM responds: "I don't have that information."
      return {
        $or: [
          { access_roles: { $in: ['general'] } },
          {
            $and: [
              { access_roles: { $in: ['student'] } },
              { student_id: { $eq: session.student_id ?? '' } },
            ],
          },
        ],
      };

    default:
      throw new Error(`Unknown role: ${(session as SessionContext).role}`);
  }
}
```

### Filter Verification Matrix

This table is the ground truth for testing. Every cell must be verified manually using
Postman with the seed data before Phase 4 is considered complete.

| Document | Admin | Teacher (own class) | Teacher (other class) | Parent (own child) | Parent (other child) | Student (self) | Student (other) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| General notice | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Homework (class_6a) | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Attendance (student_001) | ✅ | ✅ (own class) | ❌ | ✅ | ❌ | ✅ | ❌ |
| Fee record (student_001) | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Personal profile (student_001) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## PART 6 — Embedding Service (Cloudflare Workers AI + Cache)

### Why Cache Embeddings?

School users ask highly repetitive questions. "What's the timetable?", "When is the next
exam?", "What homework is due tomorrow?" — asked by dozens or hundreds of users daily
with nearly identical phrasing. Without a cache, each generates a ~300ms Cloudflare API
call. With a cache keyed on the normalized query SHA-256, the first user pays 300ms and
every subsequent user pays 0ms.

Expected cache hit rate for school query patterns: **60–70%**. This translates to the
majority of requests completing embedding in under 1ms.

```typescript
// src/services/embedding.service.ts (first draft)

const CF_EMBED_URL =
  `https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.accountId}/ai/run/${config.cloudflare.embeddingModel}`;

// In-memory cache: query hash → { vector, expires_at }
const embeddingCache = new Map<string, { vector: number[]; expires_at: number }>();

export async function embedQuery(text: string): Promise<{
  vector: number[];
  cached: boolean;
  latency_ms: number;
}> {
  const start = Date.now();
  const key = crypto.createHash('sha256').update(text.toLowerCase().trim()).digest('hex');

  const entry = embeddingCache.get(key);
  if (entry && Date.now() < entry.expires_at) {
    return { vector: entry.vector, cached: true, latency_ms: Date.now() - start };
  }

  const res = await fetch(CF_EMBED_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.cloudflare.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: [text] }),
  });

  if (!res.ok) throw new Error(`Cloudflare embedding API failed: ${res.status}`);

  const data = await res.json() as { result: { data: number[][] }; success: boolean };
  if (!data.success) throw new Error('Cloudflare embedding returned success=false');

  const vector = data.result.data[0];
  embeddingCache.set(key, { vector, expires_at: Date.now() + config.cache.ttlMs });

  return { vector, cached: false, latency_ms: Date.now() - start };
}

// Batch embedding for the ingestion pipeline — groups of 10 with 50ms delay between batches
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 10;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(CF_EMBED_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.cloudflare.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: batch }),
    });
    const data = await res.json() as { result: { data: number[][] } };
    results.push(...data.result.data);
    if (i + BATCH_SIZE < texts.length) await new Promise(r => setTimeout(r, 50));
  }

  return results;
}
```

---

## PART 7 — LLM Service (OpenAI-Compatible Gemini API + Streaming)

### Why OpenAI-Compatible API Instead of Raw Gemini SDK?

The OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/`)
lets us use the standard `openai` npm package to call Gemini models. Two reasons this is
the right choice:

1. **Portability:** If Riversand Labs ever needs to switch from Gemini to GPT-4o or another
   model, only the `baseURL` and `model` name change. The entire codebase stays identical.

2. **Battle-tested streaming:** The OpenAI SDK's streaming implementation handles edge cases
   (connection drops, partial chunks, backpressure) more reliably than the raw Gemini SDK.

### Why SSE (Server-Sent Events) Not WebSockets?

SSE is a one-directional persistent HTTP connection — server pushes events, client reads.
WebSockets are bidirectional. For a query-response pattern (one message in, one streamed
response out), SSE is simpler, requires no special server infrastructure, works through
standard HTTP proxies and load balancers, and is natively supported by every modern browser
without a special library. WebSockets add complexity with zero benefit for this use case.

```typescript
// src/services/llm.service.ts (first draft — uses openai npm package pointed at Gemini)

import OpenAI from 'openai';

// OpenAI SDK configured to hit Gemini's OpenAI-compatible endpoint
const client = new OpenAI({
  apiKey: config.gemini.apiKey,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

export async function streamGeminiResponse(
  systemPrompt: string,
  userMessage: string,
  res: Response,
  requestStart: number,
  metadata: {
    chunks_used: number;
    embedding_cached: boolean;
    retrieval_latency_ms: number;
    embedding_latency_ms: number;
  }
): Promise<void> {
  // SSE headers must be set before first write
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disables nginx response buffering
  res.flushHeaders();

  try {
    const stream = await client.chat.completions.create({
      model: config.gemini.model, // e.g. "gemini-1.5-flash"
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });

    // Stream each delta token immediately to the client
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }

    // Final event — includes full timing breakdown for observability
    res.write(`data: ${JSON.stringify({
      done: true,
      latency_ms: Date.now() - requestStart,
      ...metadata,
    })}\n\n`);
    res.end();

  } catch (error) {
    const message = error instanceof Error ? error.message : 'LLM error';
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
    console.error('[LUE] LLM streaming error:', message);
  }
}
```

---

## PART 8 — Ingestion Pipeline

### Document → Chunk → Embed → Upsert

```
Document received (id, content, metadata)
       │
       ▼
[1] CHUNKING
    If content.length <= 400 chars → single chunk, skip splitting
    If content.length > 400 chars → recursive character split:
      Try paragraph boundary (\n\n) first
      Fall back to sentence boundary (". ", "! ", "? ")
      Fall back to word boundary (" ")
      Hard split at 400 chars as last resort
    50-character overlap between consecutive chunks
    Each chunk inherits the parent document's full metadata
       │
       ▼
[2] METADATA FLATTENING
    Pinecone metadata must be flat: Record<string, string|number|boolean|string[]>
    No nested objects allowed
    The text content is stored as metadata["content"] — avoids secondary DB lookup
    The parent doc ID stored as metadata["original_doc_id"] — enables delete-and-replace
    All optional fields (student_id, class_id, teacher_id) only included if present
       │
       ▼
[3] BATCH EMBEDDING
    Collect all chunk texts from all documents
    Send to Cloudflare Workers AI in batches of 10
    50ms pause between batches (rate limit protection)
    Returns parallel array of 768-dim vectors
       │
       ▼
[4] PINECONE UPSERT
    Pair each vector with its flattened metadata
    Upsert to namespace "school_{schoolId}"
    Send in batches of 100 (Pinecone recommendation)
    Vector ID format: "{docId}_chunk_{chunkIndex}"
```

```typescript
// src/services/ingestion.service.ts (first draft)

export async function ingestDocuments(
  schoolId: string,
  documents: IngestDocument[]
): Promise<IngestResult> {
  const start = Date.now();

  // Step 1 + 2: Chunk all documents and flatten metadata
  const allChunks = documents.flatMap(doc =>
    chunkText(doc.content).map(chunk => ({
      id: `${doc.id}_chunk_${chunk.chunk_index}`,
      content: chunk.content,
      metadata: {
        ...flattenMetadata(doc.metadata),
        content: chunk.content,        // stored for retrieval without secondary lookup
        original_doc_id: doc.id,
        chunk_index: chunk.chunk_index,
      },
    }))
  );

  // Step 3: Batch embed
  const embeddings = await embedBatch(allChunks.map(c => c.content));

  // Step 4: Pair vectors and upsert
  const vectors = allChunks.map((chunk, i) => ({
    id: chunk.id,
    values: embeddings[i],
    metadata: chunk.metadata,
  }));
  await upsertVectors(schoolId, vectors);

  return {
    success: true,
    ingested: documents.length,
    chunks_created: allChunks.length,
    latency_ms: Date.now() - start,
  };
}
```

---

## PART 9 — Chunking Strategy

### Target: 400 Characters, 50-Character Overlap

The 400-character target is calibrated for school data specifically — notices, homework
descriptions, attendance summaries, fee statements. These are short, factual, and
topic-focused. Each chunk at this size is self-contained enough to answer a specific
question. The 50-character overlap prevents information loss at chunk boundaries.

```typescript
// src/utils/chunker.ts (first draft)

export function chunkText(text: string): Array<{ content: string; chunk_index: number }> {
  const cleaned = text.trim().replace(/\s+/g, ' ');

  if (cleaned.length <= 400) {
    return [{ content: cleaned, chunk_index: 0 }];
  }

  const chunks: Array<{ content: string; chunk_index: number }> = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < cleaned.length) {
    let end = Math.min(start + 400, cleaned.length);

    if (end < cleaned.length) {
      // Find natural break near end: sentence > word
      const sentenceBreak = Math.max(
        cleaned.lastIndexOf('. ', end),
        cleaned.lastIndexOf('! ', end),
        cleaned.lastIndexOf('? ', end)
      );
      const wordBreak = cleaned.lastIndexOf(' ', end);

      if (sentenceBreak > start + 200) end = sentenceBreak + 1;
      else if (wordBreak > start) end = wordBreak;
    }

    const content = cleaned.slice(start, end).trim();
    if (content.length > 20) chunks.push({ content, chunk_index: chunkIndex++ });

    start = end - 50; // 50-char overlap
    if (start < 0) start = 0;
  }

  return chunks;
}
```

---

## PART 10 — Prompt Engineering

### Role-Aware System Prompt Design

The system prompt does three things simultaneously: establishes LUE's identity, tells the
LLM exactly who it is speaking to with their specific role and name, and enforces safety
guardrails. The tone shifts by role — administrative for admin, professional for teachers,
warm for parents, friendly and encouraging for students.

```typescript
// src/utils/promptBuilder.ts (first draft)

export function buildPrompt(
  session: SessionContext,
  query: string,
  chunks: RetrievedChunk[]
): { systemPrompt: string; userMessage: string } {

  const roleContext: Record<UserRole, string> = {
    admin:
      `You are speaking to ${session.name}, a school administrator with full access to all school records. ` +
      `Provide complete, accurate information in a professional tone.`,
    teacher:
      `You are speaking to ${session.name}, a teacher responsible for classes: ${session.class_ids?.join(', ')}. ` +
      `You only have access to data for their assigned classes.`,
    parent:
      `You are speaking to ${session.name}, a parent. ` +
      `You can only see information about their own child. Be warm and clear.`,
    student:
      `You are speaking to ${session.name}, a student. ` +
      `You can only see your own academic information. Be friendly and encouraging.`,
  };

  const systemPrompt =
    `You are LUE, the intelligent assistant for the Light Up Education school management platform.\n\n` +
    `${roleContext[session.role]}\n\n` +
    `STRICT RULES:\n` +
    `1. Answer ONLY from the provided context. Never fabricate or guess.\n` +
    `2. If the context does not contain the answer, say: "I don't have that information available right now."\n` +
    `3. Never reveal any data about other students, teachers, or financial records beyond what is in the context.\n` +
    `4. Keep answers concise and directly relevant to the question.\n` +
    `5. If a question is outside school management scope, politely decline.`;

  const contextBlock = chunks.length > 0
    ? chunks.map((c, i) => `[Source ${i + 1}]\n${c.content}`).join('\n\n')
    : 'No relevant information was found in the school database for this query.';

  const userMessage = `CONTEXT:\n${contextBlock}\n\nQUESTION:\n${query}`;

  return { systemPrompt, userMessage };
}
```

---

## PART 11 — API Contracts (Postman Reference)

### POST /api/ingest — Populate the Vector Database

No auth required in Phase 1 (for testing ease). In production: require admin session.

**Request:**
```json
{
  "schoolId": "school_001",
  "documents": [
    {
      "id": "notice_sports_day",
      "content": "Annual Sports Day will be held on May 10th 2026 at the school grounds...",
      "metadata": {
        "school_id": "school_001",
        "data_category": "general",
        "access_roles": ["general"],
        "entity_type": "notice",
        "content_summary": "Sports Day announcement May 10th",
        "created_at": 1746374400000
      }
    }
  ]
}
```

**Success Response (200):**
```json
{
  "success": true,
  "ingested": 1,
  "chunks_created": 1,
  "latency_ms": 623
}
```

**Partial Success Response (207 — some documents failed):**
```json
{
  "success": false,
  "ingested": 3,
  "chunks_created": 8,
  "latency_ms": 1241,
  "errors": ["Document fee_record_002: content cannot be empty"]
}
```

---

### POST /api/query — The Main LUE Agent Endpoint

The response is a Server-Sent Events stream. In Postman, use "Send and Download" to capture
the raw SSE stream, or use the built-in SSE viewer if available.

**Request:**
```
POST /api/query
Authorization: Bearer eyJzY2hvb2xfaWQiOiJzY2hvb2xfMDAxIi4uLn0=
Content-Type: application/json

{
  "query": "What is my math homework due date?",
  "top_k": 5
}
```

**Response — SSE Stream:**
```
data: {"text":"Your"}
data: {"text":" math"}
data: {"text":" homework"}
data: {"text":" (Exercise 7.3 and 7.4)"}
data: {"text":" is due tomorrow, May 6th."}
data: {"text":" Submit in your blue notebook."}
data: {"done":true,"latency_ms":847,"chunks_used":2,"embedding_cached":false,"retrieval_latency_ms":72,"embedding_latency_ms":312}
```

**Error Response (no auth):**
```json
{ "error": "Missing or malformed Authorization header" }
```

**Error via SSE (LLM fails after stream started):**
```
data: {"error":"Gemini API rate limit exceeded"}
```

---

### GET /api/health — Server Status

```json
{
  "status": "ok",
  "pinecone": "connected",
  "cloudflare": "configured",
  "gemini": "configured",
  "embedding_cache_size": 42,
  "cache_ttl_ms": 3600000,
  "uptime_ms": 83921,
  "retrieval_settings": {
    "top_k": 5,
    "relevance_threshold": 0.65,
    "embedding_dimension": 768
  }
}
```

---

## PART 12 — Scale Analysis (1000 Concurrent Users)

### Bottleneck Analysis and Mitigations

**Cloudflare Workers AI (Embedding)** — Primary latency source at ~300ms per call. At
1000 concurrent users without cache: 1000 simultaneous API calls. With 65% cache hit rate:
~350 actual API calls. Cloudflare Workers AI is designed for high-concurrency edge
inference and handles this volume comfortably. Cache is the primary mitigation here.

**Pinecone Queries** — 50–100ms each. Pinecone serverless scales horizontally without
configuration or capacity planning. 1000 concurrent queries is well within its design range.

**Gemini API via OpenAI-compatible endpoint** — Rate limits are configured at the Google
Cloud project level. On production tiers, limits can be raised through the console. The
streaming approach means rate limit impact is minimised — even if throughput is capped,
individual users see fast first-token times because we're not waiting for complete responses.

**Node.js Event Loop** — All operations in the pipeline are async I/O (API calls, no CPU
computation). Node.js handles 1000 concurrent async I/O operations natively through the
event loop. No worker threads or clustering needed at this scale. If needed in the future,
Node.js cluster mode (one process per CPU core) doubles throughput trivially.

**Memory Footprint** — Embedding cache: ~3KB per entry × 10,000 entries = ~30MB. Pinecone
response payloads: ~5KB each, GC'd after streaming. Total: well within 512MB container
limits.

---

## PART 13 — File Structure

```
lue-agent/
├── src/
│   ├── types/
│   │   └── index.ts              # All TypeScript interfaces and type definitions
│   ├── config/
│   │   └── index.ts              # Env validation (fail-fast) + client singletons
│   ├── middleware/
│   │   ├── sessionParser.ts      # Bearer token decode → SessionContext + validation
│   │   └── requestLogger.ts      # Logs method, path, status, latency_ms per request
│   ├── services/
│   │   ├── embedding.service.ts  # Cloudflare Workers AI REST + in-memory cache
│   │   ├── pinecone.service.ts   # Namespace-scoped upsert + filtered query
│   │   ├── llm.service.ts        # OpenAI SDK → Gemini, SSE streaming
│   │   └── ingestion.service.ts  # chunk → embed → upsert orchestration
│   ├── utils/
│   │   ├── filterBuilder.ts      # SessionContext → Pinecone filter (SECURITY CORE)
│   │   ├── promptBuilder.ts      # Session + chunks → system prompt + user message
│   │   └── chunker.ts            # Long text → overlapping 400-char chunks
│   ├── routes/
│   │   ├── query.route.ts        # POST /api/query — full pipeline
│   │   ├── ingest.route.ts       # POST /api/ingest — document ingestion
│   │   └── health.route.ts       # GET /api/health — connectivity checks
│   └── app.ts                    # Express setup, middleware, route mounting, server start
├── data/
│   └── seed.json                 # Complete sample school dataset (see Part 14)
├── scripts/
│   └── seed.ts                   # Reads seed.json → POST /api/ingest → prints tokens
├── .env.example
├── package.json
└── tsconfig.json
```

---

## PART 14 — Seed Data Reference

The seed data lives in `data/seed.json`. It is the canonical test dataset that covers every
cell in the Filter Verification Matrix from Part 5. The seed script (`scripts/seed.ts`)
reads this file, POSTs it to `/api/ingest`, and then prints Base64 session tokens for all
four test personas.

**Test school:** Delhi Public School (`school_001`)
**Students:** Arjun Sharma (`student_001`, Class 6A) and Priya Patel (`student_002`, Class 7B)
**Teacher:** Ms. Meera Iyer (`teacher_001`, teaches class_6a and class_7b)
**Parent:** Mr. R. Sharma (`parent_001`, parent of student_001 only)

**After seeding, run these queries to verify role isolation:**

```
Admin token    → "What is Arjun's home address?"          → MUST return personal data
Admin token    → "What is Priya's fee status?"            → MUST return financial data

Teacher token  → "What homework is due in Class 6A?"      → MUST return homework
Teacher token  → "What homework is due in Class 8C?"      → MUST return nothing class-specific
Teacher token  → "What notices are posted?"               → MUST return general notices

Parent token   → "What are my child's outstanding fees?"  → MUST return student_001 fees
Parent token   → "What are Priya's fees?"                 → MUST return nothing (student_002 blocked)
Parent token   → "What is the exam schedule?"             → MUST return general notice

Student token  → "What is my math homework?"              → MUST return homework (class_6a)
Student token  → "What is Priya's attendance?"            → MUST return nothing
Student token  → "What are my fees?"                      → MUST return nothing (financial blocked for students)
Student token  → "When is Sports Day?"                    → MUST return the general notice
```

---

## PART 15 — Environment Variables

```bash
# .env.example — copy to .env and fill in real values

PORT=3000

# Pinecone
# Create a serverless index named "lue-agent" with dimension=768, metric=cosine
# Dashboard: https://app.pinecone.io
PINECONE_API_KEY=your_pinecone_api_key_here
PINECONE_INDEX_NAME=lue-agent

# Cloudflare Workers AI
# Enable in Cloudflare dashboard → AI → Workers AI
# Generate an API token with "Workers AI" permission
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_EMBEDDING_MODEL=@cf/baai/bge-base-en-v1.5

# Google Gemini via OpenAI-compatible API
# Get API key from https://aistudio.google.com
# Use with OpenAI SDK pointed at: https://generativelanguage.googleapis.com/v1beta/openai/
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

# Retrieval tuning — sensible defaults, adjust based on testing
EMBEDDING_DIMENSION=768
RETRIEVAL_TOP_K=5
RELEVANCE_THRESHOLD=0.65
EMBEDDING_CACHE_TTL_MS=3600000
```

---

## PART 16 — Implementation Phases

> **IMPORTANT INSTRUCTION TO CODEX:**
> Implement **strictly one phase at a time.**
> After completing each phase, **stop completely** and wait for the human to review.
> Only after receiving explicit approval ("looks good, move to Phase N+1") should you
> proceed. Do not implement multiple phases in one response even if they seem small.

---

### Phase 1 — Project Skeleton & Type System

**Goal:** A working Express server that starts cleanly, validates its environment on boot,
and returns a meaningful health check. No AI integrations yet — pure foundation.

**Codex improvement:** In Phase 1, environment validation means validating presence,
types, and defaults only. The server must not connect to Pinecone, Cloudflare, or Gemini
during boot. Local development may use clearly marked placeholder values in a gitignored
`.env` until real service credentials are available; Phase 3+ is where live credentials
become necessary for external API acceptance tests.

**Codex improvement:** Namespace values should use the canonical `school_id` string exactly
as supplied by the session and seed data, for example `school_001`. Do not add an extra
`school_` prefix in service code; doing so would write `school_001` records into
`school_school_001` and make retrieval miss the seeded data.

**Deliverables:**
- `package.json` with all dependencies: `express`, `openai`, `@pinecone-database/pinecone`,
  `zod`, `dotenv`, `cors`, and their TypeScript type packages (`@types/express`, `@types/cors`, etc.)
- `tsconfig.json` with `strict: true`, `esModuleInterop: true`, `target: ES2020`
- `.env.example` with every required variable documented with a comment explaining where to get it
- `src/types/index.ts` — complete TypeScript interfaces for `UserRole`, `DataCategory`,
  `SessionContext`, `DocumentMetadata`, `IngestDocument`, `IngestRequest`, `IngestResult`,
  `RetrievedChunk`, `QueryRequest`, `CacheEntry`
- `src/config/index.ts` — reads `.env`, validates every required variable at startup (throws
  with the missing variable name if absent), exports `config` object and lazy client singletons
  for Pinecone and the OpenAI client (pointed at Gemini endpoint)
- `src/middleware/requestLogger.ts` — on every response finish event, logs:
  `[LUE] method=POST path=/api/query status=200 latency=847ms`
- `src/routes/health.route.ts` — GET /api/health returns `{"status":"ok"}` plus all
  configured service names and current uptime_ms
- `src/app.ts` — Express setup with `cors()`, `express.json({limit:"2mb"})`, requestLogger,
  health route mounted at `/api/health`, 404 handler, global error handler, listens on PORT

**Acceptance criteria:**
- `npm run dev` starts without errors
- `GET /api/health` returns 200 with `{"status":"ok",...}`
- Removing any required `.env` key causes startup to fail with a clear error naming the missing key
- Every request to any route logs method, path, status, and latency_ms

**⛔ STOP HERE. Do not write Phase 2 until the human approves Phase 1.**

---

### Phase 2 — Session Authentication & Filter Builder

**Goal:** Working session parsing middleware and the security-critical filter builder, both
verifiable without any external API calls.

**Deliverables:**
- `src/middleware/sessionParser.ts` — decodes Base64 Bearer token, validates all required
  fields with role-specific checks (teacher must have `class_ids`, student must have
  `student_id`, parent must have `student_ids`), returns descriptive 401 on any failure,
  attaches `req.session` for downstream use. Add TypeScript declaration to extend
  `Express.Request` with the `session` field.
- `src/utils/filterBuilder.ts` — pure function `buildPineconeFilter(session): Record<string, unknown>`,
  one branch per role, matching exactly the filter logic in Part 5 of this document.
  This file must have no imports from services or external APIs — it is pure logic only.
- Update `src/routes/health.route.ts` to add `GET /api/health/auth` which applies
  `sessionParser` and echoes back the parsed `req.session` as JSON — useful for
  debugging tokens in Postman

**Acceptance criteria:**
- Generate all four tokens using the code in Part 3. Each parses correctly and
  `/api/health/auth` echoes the session back
- A teacher token missing `class_ids` returns 401 with a message mentioning `class_ids`
- A student token missing `student_id` returns 401 with a message mentioning `student_id`
- Log the filter object output for each role and verify it matches the matrix in Part 5

**⛔ STOP HERE. Do not write Phase 3 until the human approves Phase 2.**

---

### Phase 3 — Embedding Service & Ingestion Pipeline

**Goal:** Full ability to take raw text documents, chunk, embed via Cloudflare, and store
in Pinecone with correct metadata. The vector database must be populated and queryable
after this phase.

**Deliverables:**
- `src/utils/chunker.ts` — `chunkText(text): {content, chunk_index}[]` as described in Part 9
- `src/services/embedding.service.ts` — Cloudflare Workers AI REST wrapper with in-memory
  SHA-256-keyed cache, `embedQuery()` single embed + cache, `embedBatch()` for ingestion,
  `getCacheStats()` for health endpoint
- `src/services/pinecone.service.ts` — `upsertVectors(schoolId, vectors)` and
  `queryVectors(schoolId, vector, filter, topK)` both namespace-scoped as described in Part 4
- `src/services/ingestion.service.ts` — orchestrates chunk → flatten metadata → batch embed
  → upsert, returns `IngestResult`
- `src/routes/ingest.route.ts` — POST /api/ingest with Zod schema validating the full
  request body including nested metadata fields
- `data/seed.json` — complete dataset covering all documents described in Part 14
- `scripts/seed.ts` — reads `data/seed.json`, POSTs to `/api/ingest`, on success prints
  all four Base64 session tokens and the test query list from Part 14

**Acceptance criteria:**
- `npm run seed` completes successfully, reports ingested doc count and chunk count
- Pinecone dashboard shows vectors in the `school_001` namespace
- `GET /api/health` shows `"pinecone": "connected"` and correct `embedding_cache_size`
- POST /api/ingest with a malformed body returns a Zod validation error listing exactly which fields are wrong

**⛔ STOP HERE. Do not write Phase 4 until the human approves Phase 3.**

---

### Phase 4 — Query Pipeline & LLM Streaming

**Goal:** The complete end-to-end query pipeline — from a user's natural language question
to a streaming LLM response with full role-based access control. This is the primary
deliverable of the entire project.

**Deliverables:**
- `src/utils/promptBuilder.ts` — `buildPrompt(session, query, chunks)` returning
  `{systemPrompt, userMessage}` with role-appropriate tone as described in Part 10
- `src/services/llm.service.ts` — `streamGeminiResponse(...)` using OpenAI SDK pointed at
  Gemini's OpenAI-compatible endpoint, SSE streaming with per-token writes, completion
  event with full timing metadata, error handling that closes the SSE stream cleanly
- `src/routes/query.route.ts` — POST /api/query protected by `sessionParser`, Zod validation
  on body, full pipeline orchestration: filter → embed → retrieve → prompt → stream, with
  console logging of every step's latency

**Acceptance criteria (run all queries from Part 14's test list):**
- Admin asking "What is Arjun's home address?" receives the personal profile data
- Student (Arjun) asking "What are Priya's fees?" receives "I don't have that information"
  (NOT Priya's fee record — this is the most critical security test)
- Student asking "When is Sports Day?" receives the general notice
- SSE events stream correctly in Postman — text appears token by token
- Every query's console log shows embed_latency, retrieval_latency, chunks_used, total_latency
- Second identical query shows `embedding_cached: true` and near-zero embed latency

**⛔ STOP HERE. Do not write Phase 5 until the human approves Phase 4.**

---

### Phase 5 — Hardening & Observability

**Goal:** Make the system reliable under failure conditions and fully observable in production.

**Deliverables:**
- Graceful degradation on Cloudflare failure: structured SSE error event instead of crash
- Graceful degradation on Pinecone failure: attempt LLM response with "no context" message
- Graceful degradation on Gemini failure: clean SSE error event and connection close
- `X-Request-ID` header on every response (generate UUID per request, log it with every
  console.log in that request's pipeline)
- Structured JSON logging: every pipeline log line outputs
  `{request_id, school_id, role, step, latency_ms, ...stepSpecificFields}`
- Simple in-memory rate limiter per `school_id`: configurable requests-per-minute, returns
  429 with `Retry-After` header when exceeded
- README section documenting the complete Postman collection (all routes, headers, body
  shapes, example tokens, expected responses)

**Acceptance criteria:**
- Set `CLOUDFLARE_API_TOKEN=wrong` — queries return `data: {"error":"..."}` cleanly, server stays running
- Set `PINECONE_API_KEY=wrong` — same graceful behaviour
- All console output is valid JSON parseable by a log aggregator
- Rate limiter triggers correctly after configured threshold
- All Phase 4 acceptance criteria still pass after Phase 5 changes

**⛔ STOP HERE. Await final review before any further work.**
