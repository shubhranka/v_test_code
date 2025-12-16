import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConversationsService } from './conversations.service';
import { Session, SessionSchema } from './schemas/session.schema';
import { Event, EventSchema } from './schemas/event.schema';
import { ConversationsController } from './conversations.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Session.name, schema: SessionSchema },
      { name: Event.name, schema: EventSchema },
    ]),
  ],
  providers: [ConversationsService],
  exports: [ConversationsService],
  controllers: [ConversationsController],
})
export class ConversationsModule {}
