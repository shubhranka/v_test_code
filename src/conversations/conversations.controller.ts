import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { PaginationDto } from './dto/pagination.dto';

@Controller('sessions')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSession(@Body() createSessionDto: CreateSessionDto) {
    return this.conversationsService.createSession(createSessionDto);
  }

  @Post(':sessionId/events')
  @HttpCode(HttpStatus.CREATED)
  async addEvent(
    @Param('sessionId') sessionId: string,
    @Body() createEventDto: CreateEventDto,
  ) {
    return this.conversationsService.addEvent(sessionId, createEventDto);
  }

  @Get(':sessionId')
  async getSession(
    @Param('sessionId') sessionId: string,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.conversationsService.getSession(sessionId, paginationDto);
  }

  @Post(':sessionId/complete')
  @HttpCode(HttpStatus.OK)
  async completeSession(@Param('sessionId') sessionId: string) {
    return this.conversationsService.completeSession(sessionId);
  }
}
