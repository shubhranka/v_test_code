import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum SessionStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
}

@Schema({ timestamps: true })
export class Session extends Document {
  @Prop({ required: true, unique: true, index: true })
  sessionId: string;

  @Prop({ required: true, enum: SessionStatus, default: SessionStatus.ACTIVE })
  status: SessionStatus;

  @Prop({ required: true })
  language: string;

  @Prop({ required: true })
  startedAt: Date;

  @Prop()
  endedAt?: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

// Compound unique index for idempotency (sessionId)
SessionSchema.index({ sessionId: 1 }, { unique: true });
