import { IsString, IsNotEmpty, IsEnum, IsObject, IsDateString } from 'class-validator';
import { EventType } from '../schemas/event.schema';

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  eventId: string;

  @IsEnum(EventType)
  @IsNotEmpty()
  type: EventType;

  @IsObject()
  @IsNotEmpty()
  payload: Record<string, any>;

  @IsDateString()
  @IsNotEmpty()
  timestamp: string;
}
