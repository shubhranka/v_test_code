# Conversation Service - Design Documentation

## Overview

The Conversation Service is a NestJS application designed to manage conversational sessions and their associated events with guarantees for concurrency safety and idempotency.

## Architecture

### Layered Architecture

The application follows a three-layer architecture:

```
┌─────────────────────────────────────┐
│         API Layer (Controller)       │  - Request validation
│         - REST endpoints             │  - HTTP concerns
│         - DTO validation             │  - Response formatting
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│       Business Logic (Service)       │  - Core business logic
│       - Concurrency handling         │  - Idempotency logic
│       - Error handling               │  - Data transformations
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│      Data Layer (Schemas/Models)     │  - Data modeling
│      - MongoDB schemas               │  - Database constraints
│      - Indexes                       │  - Query optimization
└─────────────────────────────────────┘
```

### Module Structure

```
AppModule
├── ConfigModule (Global)
├── MongooseModule (Database Connection)
└── ConversationsModule
    ├── Session Schema
    ├── Event Schema
    ├── ConversationsService
    └── ConversationsController
```

## Core Design Decisions

### 1. Concurrency Control

**Challenge**: Multiple simultaneous requests to create a session with the same `sessionId` should result in only one database record.

**Solution**: MongoDB's atomic `findOneAndUpdate` operation with `upsert: true` and `$setOnInsert`

```typescript
await this.sessionModel.findOneAndUpdate(
  { sessionId: dto.sessionId },
  { $setOnInsert: { /* fields */ } },
  { upsert: true, new: true }
);
```

**Why this works**:
- The operation is atomic at the database level
- `$setOnInsert` only sets fields if a new document is created
- MongoDB's unique index on `sessionId` prevents duplicates
- All concurrent requests will either:
  - Win the race and create the document, OR
  - Retrieve the already-created document

**Alternative approaches considered**:
- Distributed locks (Redis): Adds complexity and external dependency
- Application-level locking: Not reliable in multi-instance deployments
- Try-catch with duplicate key handling: Race conditions possible

### 2. Idempotency

**Challenge**: The same event (identified by `sessionId` + `eventId`) should not be added multiple times.

**Solution**: Compound unique index on `{sessionId, eventId}` + graceful error handling

```typescript
// Schema level
EventSchema.index({ sessionId: 1, eventId: 1 }, { unique: true });

// Service level
try {
  const event = await this.eventModel.create(dto);
  return event;
} catch (error) {
  if (error.code === 11000) {
    // Return existing event instead of error
    return await this.eventModel.findOne({
      sessionId,
      eventId: dto.eventId
    });
  }
  throw error;
}
```

**Why this works**:
- Database enforces uniqueness constraint
- Duplicate requests receive HTTP 201 (not 409 or 400)
- Clients can safely retry without checking previous status
- Maintains idempotency semantics

**Important considerations**:
- We return the existing event, not null or error
- This maintains true idempotency: same input → same output
- Status code remains 201 for consistency

### 3. Data Modeling

#### Session Schema

```typescript
{
  sessionId: String (unique, indexed),
  status: Enum['active', 'completed'],
  language: String,
  startedAt: Date,
  endedAt?: Date
}
```

**Design choices**:
- `sessionId` as business key (not relying on MongoDB `_id`)
- Status enum for type safety and validation
- Separate `startedAt`/`endedAt` for audit trail
- Unique index on `sessionId` for concurrency control

#### Event Schema

```typescript
{
  eventId: String,
  sessionId: String (indexed),
  type: Enum[...],
  payload: Mixed,
  timestamp: Date
}
```

**Indexes**:
1. Compound unique: `{sessionId: 1, eventId: 1}` - Idempotency
2. Compound sorted: `{sessionId: 1, timestamp: 1}` - Query performance

**Design choices**:
- `payload` as Mixed type for flexibility
- `timestamp` from client (not server) for accurate event ordering
- Compound index covers both uniqueness and query patterns
- `sessionId` indexed separately for foreign key-like queries

### 4. Pagination Strategy

**Implementation**: Offset-based pagination with limit

```typescript
.find({ sessionId })
.sort({ timestamp: 1 })
.skip(offset)
.limit(limit)
```

**Trade-offs**:

| Approach | Pros | Cons |
|----------|------|------|
| Offset-based (chosen) | Simple, stateless, jump to any page | Performance degrades with large offsets |
| Cursor-based | Better performance, no skipped records | Can't jump pages, more complex |
| Keyset pagination | Best performance | Complex implementation, requires unique key |

**Why offset-based**:
- Simpler implementation for MVP
- Acceptable performance for typical session sizes (<10k events)
- Can be migrated to cursor-based later if needed
- Query is optimized by `{sessionId, timestamp}` index

**Default limits**:
- Default: 50 events
- Maximum: 100 events (prevents abuse)
- Configurable via query parameters

### 5. Error Handling

**Global Exception Filter**: Ensures all errors return consistent JSON format

```typescript
{
  statusCode: number,
  timestamp: string,
  path: string,
  message: string | object
}
```

**Error categories**:
- Validation errors (400): Handled by ValidationPipe
- Not found errors (404): Explicit NotFoundException
- Server errors (500): Caught by global filter
- Database errors: Specific handling (e.g., duplicate key)

**Logging strategy**:
- All errors logged with stack traces
- Successful operations logged at INFO level
- Sensitive data never logged

### 6. Validation Strategy

**Three-level validation**:

1. **DTO Level** (class-validator decorators)
   ```typescript
   @IsString()
   @IsNotEmpty()
   sessionId: string;
   ```

2. **Pipe Level** (Global ValidationPipe)
   ```typescript
   app.useGlobalPipes(new ValidationPipe({
     transform: true,        // Transform types
     whitelist: true,        // Strip unknown properties
     forbidNonWhitelisted: true  // Throw on unknown properties
   }));
   ```

3. **Business Level** (Service layer checks)
   ```typescript
   // Example: Check session exists before adding event
   const session = await this.sessionModel.findOne({ sessionId });
   if (!session) throw new NotFoundException();
   ```

## Database Design

### Indexes Summary

| Collection | Index | Type | Purpose |
|------------|-------|------|---------|
| sessions | sessionId | Unique | Primary key, concurrency control |
| events | {sessionId, eventId} | Compound Unique | Idempotency enforcement |
| events | {sessionId, timestamp} | Compound | Query optimization for pagination |

### Index Performance Impact

**Session Creation**:
- O(log n) for unique check on `sessionId`
- Prevents duplicate sessions at database level

**Event Addition**:
- O(log n) for unique check on compound key
- O(log n) for timestamp ordering

**Event Query**:
- O(log n) to find first matching sessionId
- O(k) to return k events (sorted by timestamp)
- Index covers entire query (no collection scan)

### Scaling Considerations

**Current design supports**:
- Thousands of concurrent sessions
- Millions of total events
- 100+ concurrent requests

**Future optimizations** (if needed):
- Sharding by sessionId
- Archive old sessions to cold storage
- Separate read replicas for queries
- Caching layer (Redis) for hot sessions

## API Design

### RESTful Principles

**Resource-oriented URLs**:
```
/sessions                    - Session collection
/sessions/:id                - Specific session
/sessions/:id/events         - Events sub-resource
/sessions/:id/complete       - Action on session
```

**HTTP Methods**:
- POST: Create resources (sessions, events)
- GET: Retrieve resources
- Status codes: 201 (created), 200 (ok), 404 (not found)

**Design choices**:
- Plural nouns for collections (`/sessions` not `/session`)
- Nested routes for sub-resources (`/sessions/:id/events`)
- Action verbs only for non-CRUD operations (`/complete`)

### Response Formats

**Consistent structure**:
- Success: Returns resource representation
- Error: Returns error object with statusCode, message, timestamp, path
- Pagination: Returns {session, events, total}

## Security Considerations

### Input Validation

- All inputs validated using class-validator
- Unknown properties stripped (whitelist: true)
- Type coercion enabled for query parameters
- Enum validation for status and event types

### Injection Prevention

- MongoDB queries use parameterized operations
- Mongoose handles escaping automatically
- No raw query string construction
- Payload field stored as-is (application's responsibility to sanitize)

### Rate Limiting (Not Implemented)

**Future enhancement**:
```typescript
// Recommended for production
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP
}));
```

### Authentication/Authorization (Not Implemented)

**Future enhancement**:
```typescript
// Example middleware
@UseGuards(JwtAuthGuard)
@Controller('sessions')
export class ConversationsController { }
```

## Testing Strategy

### Manual Testing

**Concurrency test**:
```bash
for i in {1..10}; do
  curl -X POST http://localhost:3000/sessions \
    -d '{"sessionId":"test","language":"en"}' &
done
```

**Expected**: Only 1 document in database

**Idempotency test**:
```bash
# Send same event twice
curl -X POST http://localhost:3000/sessions/test/events \
  -d '{"eventId":"e1","type":"message_sent","payload":{},"timestamp":"..."}'
curl -X POST http://localhost:3000/sessions/test/events \
  -d '{"eventId":"e1","type":"message_sent","payload":{},"timestamp":"..."}'
```

**Expected**: Both return 201, only 1 event in database

### Automated Testing (Recommended)

**Unit tests** (Service layer):
```typescript
describe('ConversationsService', () => {
  it('should handle concurrent session creation', async () => {
    const promises = Array(10).fill(null).map(() =>
      service.createSession({ sessionId: 'test', language: 'en' })
    );
    await Promise.all(promises);
    const count = await sessionModel.countDocuments({ sessionId: 'test' });
    expect(count).toBe(1);
  });
});
```

**Integration tests** (E2E):
```typescript
describe('POST /sessions/:id/events', () => {
  it('should be idempotent', async () => {
    const dto = { eventId: 'e1', /* ... */ };
    const res1 = await request(app).post('/sessions/s1/events').send(dto);
    const res2 = await request(app).post('/sessions/s1/events').send(dto);
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.eventId).toBe(res2.body.eventId);
  });
});
```

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Create Session | O(log n) | Index lookup + insert |
| Add Event | O(log n) | Two index updates |
| Get Session | O(1) | Direct sessionId lookup |
| Get Events (paginated) | O(log n + k) | Index seek + k results |
| Complete Session | O(log n) | Index lookup + update |

Where:
- n = total documents in collection
- k = page size (limit)

### Space Complexity

**Per Session**: ~200 bytes
- sessionId: ~20 bytes
- status: ~10 bytes
- language: ~5 bytes
- dates: 16 bytes
- metadata: ~150 bytes

**Per Event**: ~100-500 bytes (depends on payload)
- eventId: ~20 bytes
- sessionId: ~20 bytes
- type: ~15 bytes
- timestamp: 8 bytes
- payload: variable (usually 50-400 bytes)
- metadata: ~50 bytes

**Estimated capacity** (on typical hardware):
- 10M sessions: ~2 GB
- 100M events (avg 300 bytes): ~30 GB
- Total with indexes: ~40-50 GB

## Deployment Considerations

### Environment Configuration

Required environment variables:
```
MONGODB_URI=mongodb://localhost:27017/conversation_db
PORT=3000
```

### Docker Deployment

**MongoDB setup**:
- Uses official MongoDB 7.0 image
- Persistent volume for data
- Health checks configured
- Exposed on port 27017

**Application deployment**:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["node", "dist/main"]
```

### Scaling Strategy

**Horizontal scaling** (multiple instances):
- Stateless application design
- No in-memory state
- Load balancer in front
- All state in MongoDB

**Database scaling**:
- MongoDB replica set for HA
- Read replicas for query load
- Sharding if >1TB data

### Monitoring

**Recommended metrics**:
- Request rate and latency (per endpoint)
- Error rate (per status code)
- Database query performance
- Connection pool utilization
- Memory and CPU usage

**Health check endpoint**:
```typescript
@Get('health')
async health() {
  return {
    status: 'ok',
    mongodb: await this.checkMongoHealth()
  };
}
```

## Future Enhancements

### Phase 2 Features

1. **WebSocket Support**: Real-time event streaming
2. **Event Filtering**: Query events by type, date range
3. **Bulk Operations**: Batch event creation
4. **Session Analytics**: Event counts, duration metrics
5. **Soft Deletes**: Archive sessions without deletion

### Technical Improvements

1. **Caching Layer**: Redis for frequently accessed sessions
2. **Message Queue**: Async event processing (RabbitMQ/SQS)
3. **GraphQL API**: Alternative to REST
4. **Full-text Search**: ElasticSearch for event content
5. **Compression**: Compress old event payloads

### Operational Enhancements

1. **Authentication**: JWT-based auth
2. **Rate Limiting**: Per-user or per-IP limits
3. **API Versioning**: Support multiple API versions
4. **Audit Logging**: Track all mutations
5. **Metrics Dashboard**: Grafana + Prometheus

## Conclusion

This design prioritizes:
- **Correctness**: Concurrency safety and idempotency guarantees
- **Simplicity**: Clean architecture without over-engineering
- **Performance**: Efficient indexes and query patterns
- **Maintainability**: Clear separation of concerns
- **Scalability**: Design supports growth with minimal changes