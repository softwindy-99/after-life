import { z } from 'zod';
import { SchemaPipe } from 'src/validation';
import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Self } from 'src/permission/permission.decorator';
import { CheckIn } from './check-in.entity';
import { CheckInService } from './check-in.service';

@Self()
@Controller('check-in')
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Post()
  async create(
    @Req() request: Request,
    @Body(
      new SchemaPipe(z.object({ source: z.string().trim().min(1).max(120).optional() }).strict()),
    )
    body: { source?: string },
  ) {
    return this.toDto(await this.checkInService.create(request.user.uuid, body.source));
  }

  @Get('status')
  async status(@Req() request: Request) {
    const result = await this.checkInService.getStatus(request.user.uuid);
    return {
      lastSeenAt: result.lastSeenAt,
      baselineAt: result.baselineAt,
      baselineSource: result.baselineSource,
      checkIn: result.checkIn ? this.toDto(result.checkIn) : null,
    };
  }

  private toDto(checkIn: CheckIn) {
    return { uuid: checkIn.uuid, checkedAt: checkIn.checkedAt, source: checkIn.source };
  }
}
