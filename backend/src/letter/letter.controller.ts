import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Self } from 'src/permission/permission.decorator';
import { SchemaPipe } from 'src/validation';
import { DeliveryReview } from './delivery-review';
import { LetterDto, toLetterDto } from './letter.dto';
import {
  CreateLetterInput,
  DeliveryPreviewInput,
  UpdateLetterInput,
  deliveryPreviewSchema,
  newLetterSchema,
  updateLetterSchema,
} from './letter.schema';
import { LetterService } from './letter.service';

@Self()
@Controller('letter')
export class LetterController {
  constructor(private readonly letterService: LetterService) {}

  @Get()
  async query(@Req() request: Request): Promise<LetterDto[]> {
    return (await this.letterService.findByUser(request.user.uuid)).map(toLetterDto);
  }

  @Get(':uuid')
  async queryOne(
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Req() request: Request,
  ): Promise<LetterDto> {
    const letter = await this.letterService.findOwnedOne(uuid, request.user.uuid);
    if (!letter) throw new NotFoundException('letter not found');
    return toLetterDto(letter);
  }

  /** 传输层只负责严格校验和映射，归属、版本与投递核对均在服务事务内执行。
   * Normalize at the transport boundary; check ownership, versions and consent inside the transaction. */
  @Post()
  async create(
    @Body(new SchemaPipe(newLetterSchema)) input: CreateLetterInput,
    @Req() request: Request,
  ): Promise<LetterDto> {
    const { title, content, contactUuids, deliveryPreviewToken, ...fields } = input;
    return toLetterDto(
      await this.letterService.insert(
        {
          title,
          content,
          ...fields,
          user: { uuid: request.user.uuid },
          contacts: contactUuids?.map((uuid) => ({ uuid })),
        },
        { token: deliveryPreviewToken },
      ),
    );
  }

  @Post('delivery-preview')
  @HttpCode(200)
  async previewDelivery(
    @Body(new SchemaPipe(deliveryPreviewSchema)) input: DeliveryPreviewInput,
    @Req() request: Request,
  ): Promise<DeliveryReview> {
    return this.letterService.previewDelivery(request.user.uuid, input);
  }

  @Put(':uuid')
  async update(
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Body(new SchemaPipe(updateLetterSchema)) input: UpdateLetterInput,
    @Req() request: Request,
  ): Promise<LetterDto> {
    const { contactUuids, deliveryPreviewToken, expectedUpdatedAt, ...fields } = input;
    const letter = await this.letterService.updateOwned(
      uuid,
      request.user.uuid,
      {
        ...fields,
        contacts: contactUuids?.map((uuid) => ({ uuid })),
      },
      undefined,
      expectedUpdatedAt,
      { token: deliveryPreviewToken },
    );
    if (!letter) throw new NotFoundException('letter not found');
    return toLetterDto(letter);
  }

  @Delete(':uuid')
  @HttpCode(204)
  async remove(
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Req() request: Request,
  ): Promise<void> {
    const letter = await this.letterService.findOwnedOne(uuid, request.user.uuid);
    if (!letter) throw new NotFoundException('letter not found');
    await this.letterService.removeOwned(uuid, request.user.uuid);
  }
}
