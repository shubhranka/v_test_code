# Design Document - Conversation Session Service

## 1. How did you ensure idempotency?

Idempotency is ensured primarily through database-level constraints and atomic operations, rather than application-level checks which can fail under race conditions.

*   **Session Creation (`POST /sessions`)**:
    *   I utilize MongoDB's `findOneAndUpdate` operation with the option `{ upsert: true, new: true, setDefaultsOnInsert: true }`.
    *   We use `$setOnInsert` for fields that should only be set once (like `startedAt` and `language`), ensuring that repeated calls with the same `sessionId` return the existing document without overwriting specific initialization data.

*   **Adding Events (`POST /sessions/.../events`)**:
    *   I rely on a MongoDB **Compound Unique Index** on `{ sessionId: 1, eventId: 1 }`.
    *   If a request attempts to insert a duplicate event, MongoDB throws a Duplicate Key Error (`E11000`).
    *   The service layer catches this specific error and suppresses it (returning the existing event or a success status). This satisfies the requirement "Duplicate requests should not create duplicate events" while making the API safe to retry.

*   **Completing Sessions (`POST /.../complete`)**:
    *   This is handled via a direct `$set` operation updating `status` to `completed` and setting `endedAt`.
    *   Since setting a value to a constant is an idempotent operation (applying it 1 time or 100 times results in the same state), no complex locking is required.

## 2. How does your design behave under concurrent requests?

The design delegates concurrency management to the database engine (MongoDB), which guarantees atomic document-level operations.

*   **Concurrent Session Creation**: If two requests try to create session "A" simultaneously, MongoDB's internal locking ensures only one write succeeds in creating the document. The second request will match the newly created document and return it via the `findOneAndUpdate` mechanism.
*   **Concurrent Event Insertion**: Due to the unique compound index, if two requests try to push the same `eventId` for the same session at the same time, one will succeed and the other will fail at the database level. The application catches this failure to ensure the client receives a consistent response.
*   **Race Conditions on Status**: Since we are not doing "read-modify-write" cycles (e.g., fetch session -> check status -> save session) in the application code, but rather using atomic update operators (`$set`, `$push`), we avoid the "lost update" problem common in concurrent environments.

## 3. What MongoDB indexes did you choose and why?

*   **Collection: `sessions`**
    *   `{ sessionId: 1 }` (Unique):
        *   **Why**: Required to identify sessions uniquely and perform fast lookups/upserts by the external ID.

*   **Collection: `events`**
    *   `{ sessionId: 1, eventId: 1 }` (Unique):
        *   **Why**: Enforces the business rule that an event ID must be unique *within* a session, allowing the same event ID to exist in *different* sessions if needed. This also handles the idempotency logic.
    *   `{ sessionId: 1, timestamp: 1 }`:
        *   **Why**: This is the "Workhorse" index for the `GET /sessions/:sessionId` endpoint. It allows the database to filter by session AND sort by time efficiently without performing an in-memory sort (blocking sort), which is crucial for performance as event lists grow.

## 4. How would you scale this system for millions of sessions per day?

*   **Sharding**:
    *   As data volume exceeds single-node capacity, I would enable Sharding on the MongoDB cluster.
    *   **Shard Key**: `sessionId`.
    *   **Reasoning**: This ensures that the Session document and all its related Event documents (if stored in a separate collection but sharded by the same key) reside on the same physical shard. This optimizes the `GET` query (Scatter-Gather queries are avoided) and writes (updates go to a single shard).

*   **Data Archival**:
    *   Voice sessions are typically "hot" only for a short duration. I would implement a TTL (Time To Live) index or a background cron job to move completed sessions older than X days to cold storage (e.g., S3 Parquet files or a Data Warehouse) to keep the active working set in MongoDB small and fast.

## 5. What did you intentionally keep out of scope, and why?

*   **Complex Input Validation**: I used basic DTO validation. I did not implement strict checking on the *contents* of the `payload` object in events, assuming the schema is flexible (NoSQL advantage).
*   **Update "startedAt" logic**: The requirements were "Create or Upsert". I assumed if a session exists, we do *not* update the `startedAt` date, as that would imply the conversation restarted.
*   **Soft Deletes**: I did not implement soft deletion logic as there was no requirement to delete sessions.
*   **Transactions**: I did not use multi-document transactions (Sessions + Events). Since the operations are decoupled (we create a session first, then add events), atomic single-document operations are sufficient and more performant than ACID transactions in MongoDB.