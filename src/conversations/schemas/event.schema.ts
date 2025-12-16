import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes } from 'mongoose';

export enum EventType {
  MESSAGE_SENT = 'message_sent',
  MESSAGE_RECEIVED = 'message_received',
  USER_JOINED = 'user_joined',
  USER_LEFT = 'user_left',
}

@Schema({ timestamps: true })
export class Event extends Document {
  @Prop({ required: true })
  eventId: string;

  @Prop({ required: true, index: true })
  sessionId: string;

  @Prop({ required: true, enum: EventType })
  type: EventType;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  payload: Record<string, any>;

  @Prop({ required: true })
  timestamp: Date;
}

export const EventSchema = SchemaFactory.createForClass(Event);

// Compound unique index for idempotency (sessionId + eventId)
EventSchema.index({ sessionId: 1, eventId: 1 }, { unique: true });

// Index for efficient sorting and querying by sessionId and timestamp
EventSchema.index({ sessionId: 1, timestamp: 1 });
