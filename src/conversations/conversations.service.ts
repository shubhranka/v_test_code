import {
  Injectable,
  NotFoundException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionStatus } from './schemas/session.schema';
import { Event } from './schemas/event.schema';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { PaginationDto } from './dto/pagination.dto';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectModel(Session.name) private sessionModel: Model<Session>,
    @InjectModel(Event.name) private eventModel: Model<Event>,
  ) {}

  async createSession(dto: CreateSessionDto): Promise<Session> {
    try {
      // Use findOneAndUpdate with upsert for atomic operation
      // This ensures concurrent requests with same sessionId create only one document
      const session = await this.sessionModel.findOneAndUpdate(
        { sessionId: dto.sessionId },
        {
          $setOnInsert: {
            sessionId: dto.sessionId,
            language: dto.language,
            status: SessionStatus.ACTIVE,
            startedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      );

      this.logger.log(`Session created or retrieved: ${dto.sessionId}`);
      return session;
    } catch (error) {
      this.logger.error(
        `Error creating session ${dto.sessionId}: ${error.message}`,
      );
      throw new InternalServerErrorException('Failed to create session');
    }
  }

  async addEvent(sessionId: string, dto: CreateEventDto): Promise<Event> {
    // Validate session exists
    const session = await this.sessionModel.findOne({ sessionId });
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    try {
      // Create event - compound unique index ensures idempotency
      const event = await this.eventModel.create({
        eventId: dto.eventId,
        sessionId,
        type: dto.type,
        payload: dto.payload,
        timestamp: new Date(dto.timestamp),
      });

      this.logger.log(
        `Event ${dto.eventId} added to session ${sessionId}`,
      );
      return event;
    } catch (error) {
      // Handle duplicate key error (code 11000) - idempotency
      if (error.code === 11000) {
        this.logger.log(
          `Event ${dto.eventId} already exists for session ${sessionId}, returning existing event`,
        );
        // Return existing event instead of throwing error
        const existingEvent = await this.eventModel.findOne({
          sessionId,
          eventId: dto.eventId,
        });
        if (!existingEvent) {
          throw new InternalServerErrorException(
            'Duplicate key error but event not found',
          );
        }
        return existingEvent;
      }

      this.logger.error(
        `Error adding event to session ${sessionId}: ${error.message}`,
      );
      throw new InternalServerErrorException('Failed to add event');
    }
  }

  async getSession(
    sessionId: string,
    paginationDto: PaginationDto,
  ): Promise<{ 
    session: Session; 
    events: Event[]; 
    pagination: {
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
      nextOffset: number | null;
    };
   }> {
    // Fetch session
    const session = await this.sessionModel.findOne({ sessionId });
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    // Fetch events with pagination
    const { limit = 50, offset = 0 } = paginationDto;
    const events = await this.eventModel
      .find({ sessionId })
      .sort({ timestamp: 1 })
      .skip(offset)
      .limit(limit)
      .exec();

    // Get total count for pagination
    const total = await this.eventModel.countDocuments({ sessionId });

    // Calculate pagination metadata
    const hasMore = offset + limit < total;
    const nextOffset = hasMore ? offset + limit : null;

    this.logger.log(
      `Retrieved session ${sessionId} with ${events.length} events (${offset}-${offset + limit} of ${total})`,
    );

    return { 
      session, 
      events, 
      pagination: {
        total,
        limit,
        offset,
        hasMore,
        nextOffset,
      },
    };
  }

  async completeSession(sessionId: string): Promise<Session> {
    const session = await this.sessionModel.findOneAndUpdate(
      { sessionId },
      {
        $set: {
          status: SessionStatus.COMPLETED,
          endedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    this.logger.log(`Session ${sessionId} completed`);
    return session;
  }
}
