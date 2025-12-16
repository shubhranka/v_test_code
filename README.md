# Conversation Service

A robust NestJS-based conversation tracking service with support for concurrent operations, idempotency guarantees, and event streaming.

## Features

- **Concurrent-Safe Session Creation**: Multiple simultaneous requests with the same session ID create only one document
- **Idempotent Event Addition**: Duplicate event submissions are handled gracefully without errors
- **Paginated Event Retrieval**: Efficient pagination support for large conversation histories
- **MongoDB Integration**: Leverages MongoDB's atomic operations and compound indexes
- **Comprehensive Validation**: Request validation using class-validator
- **Global Error Handling**: Consistent JSON error responses

## Prerequisites

- Node.js (v18 or higher)
- Docker and Docker Compose
- npm or yarn

## Quick Start

### 1. Start MongoDB

```bash
docker-compose up -d
```

This will start a MongoDB instance on port 27017.

### 2. Install Dependencies

```bash
npm install
```

### 3. Run the Application

```bash
# Development mode with hot-reload
npm run start:dev

# Production mode
npm run start:prod
```

The API will be available at `http://localhost:3000`

## API Endpoints

### Create Session

Creates a new conversation session or returns existing one if sessionId already exists.

```bash
POST /sessions
Content-Type: application/json

{
  "sessionId": "session-123",
  "language": "en"
}
```

**Response:**
```json
{
  "_id": "...",
  "sessionId": "session-123",
  "status": "active",
  "language": "en",
  "startedAt": "2025-12-16T10:00:00.000Z"
}
```

### Add Event to Session

Adds an event to an existing session. Idempotent - duplicate eventId + sessionId combinations return the existing event.

```bash
POST /sessions/:sessionId/events
Content-Type: application/json

{
  "eventId": "event-456",
  "type": "message_sent",
  "payload": {
    "text": "Hello, world!",
    "userId": "user-789"
  },
  "timestamp": "2025-12-16T10:01:00.000Z"
}
```

**Event Types:**
- `message_sent`
- `message_received`
- `user_joined`
- `user_left`

**Response:**
```json
{
  "_id": "...",
  "eventId": "event-456",
  "sessionId": "session-123",
  "type": "message_sent",
  "payload": {
    "text": "Hello, world!",
    "userId": "user-789"
  },
  "timestamp": "2025-12-16T10:01:00.000Z"
}
```

### Get Session with Events

Retrieves a session and its events with pagination support.

```bash
GET /sessions/:sessionId?limit=50&offset=0
```

**Query Parameters:**
- `limit` (optional, default: 50, max: 100) - Number of events to return
- `offset` (optional, default: 0) - Number of events to skip

**Response:**
```json
{
  "session": {
    "_id": "...",
    "sessionId": "session-123",
    "status": "active",
    "language": "en",
    "startedAt": "2025-12-16T10:00:00.000Z"
  },
  "events": [...],
  "total": 150
}
```

### Complete Session

Marks a session as completed.

```bash
POST /sessions/:sessionId/complete
```

**Response:**
```json
{
  "_id": "...",
  "sessionId": "session-123",
  "status": "completed",
  "language": "en",
  "startedAt": "2025-12-16T10:00:00.000Z",
  "endedAt": "2025-12-16T11:00:00.000Z"
}
```

## Testing Concurrency and Idempotency

### Testing Concurrent Session Creation

Run this script to test that concurrent requests create only one session:

```bash
# Using curl with background jobs
for i in {1..10}; do
  curl -X POST http://localhost:3000/sessions \
    -H "Content-Type: application/json" \
    -d '{"sessionId":"concurrent-test","language":"en"}' &
done
wait

# Check MongoDB - should only have 1 document
docker exec -it conversation-service-mongo mongosh conversation_db --eval "db.sessions.countDocuments({sessionId:'concurrent-test'})"
```

Expected result: Only 1 document in the database

### Testing Event Idempotency

```bash
# Send the same event twice
curl -X POST http://localhost:3000/sessions/session-123/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId":"idempotent-test",
    "type":"message_sent",
    "payload":{"text":"test"},
    "timestamp":"2025-12-16T10:00:00.000Z"
  }'

# Send again - should return 201 but not create duplicate
curl -X POST http://localhost:3000/sessions/session-123/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId":"idempotent-test",
    "type":"message_sent",
    "payload":{"text":"test"},
    "timestamp":"2025-12-16T10:00:00.000Z"
  }'

# Check MongoDB - should only have 1 event
docker exec -it conversation-service-mongo mongosh conversation_db --eval "db.events.countDocuments({eventId:'idempotent-test'})"
```

Expected result: Only 1 event in the database, both requests return 201 Created

## Architecture

See [DESIGN.md](./DESIGN.md) for detailed architecture documentation.

## Project Structure

```
src/
├── conversations/
│   ├── dto/                    # Data Transfer Objects with validation
│   │   ├── create-session.dto.ts
│   │   ├── create-event.dto.ts
│   │   └── pagination.dto.ts
│   ├── schemas/                # MongoDB schemas with indexes
│   │   ├── session.schema.ts
│   │   └── event.schema.ts
│   ├── conversations.controller.ts
│   ├── conversations.service.ts
│   └── conversations.module.ts
├── filters/
│   └── http-exception.filter.ts
├── app.module.ts
└── main.ts
```

## Environment Variables

Configure these in `.env`:

```
MONGODB_URI=mongodb://localhost:27017/conversation_db
PORT=3000
```

## Development

```bash
# Run in development mode with hot-reload
npm run start:dev

# Run in debug mode
npm run start:debug

# Build for production
npm run build

# Run test
npm run test
```

## Stopping the Application

```bash
# Stop the application (Ctrl+C if running in foreground)

# Stop and remove MongoDB container
docker-compose down

# Stop and remove with data cleanup
docker-compose down -v
```