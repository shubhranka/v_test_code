import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  language: string;
}
