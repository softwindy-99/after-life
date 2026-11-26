import {
  BadRequestException,
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
import { ContactDto, toContactDto } from './contact.dto';
import { SchemaPipe } from 'src/validation';
import { newContactSchema, updateContactSchema } from './contact.schema';
import { ContactService } from './contact.service';
import { UserService } from 'src/user/user.service';
import { LetterService } from 'src/letter/letter.service';

@Self()
@Controller('contact')
export class ContactController {
  constructor(
    private readonly contactService: ContactService,
    private readonly userService: UserService,
    private readonly letterService: LetterService,
  ) {}

  private trimString(value?: string): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private normalizeOptionalValue(value?: string): string | null | undefined {
    if (value === undefined) return undefined;
    return this.trimString(value) ?? null;
  }

  private ensureValidPayload(payload: {
    name?: string;
    email?: string | null;
    phone?: string | null;
  }): void {
    if (payload.email === undefined && payload.phone === undefined) return;
    if (!payload.email && !payload.phone) {
      throw new BadRequestException('at least one contact method is required: email or phone');
    }
  }

  private async resolveOwnedLetters(userUuid: string, letterUuids?: string[]) {
    if (!letterUuids) return undefined;

    const uniqueUuids = [...new Set(letterUuids.filter(Boolean))];
    const letters = await Promise.all(
      uniqueUuids.map((uuid) => this.letterService.findOwnedOne(uuid, userUuid)),
    );

    if (letters.some((letter) => !letter)) {
      throw new BadRequestException('all related letters must exist and belong to current user');
    }

    return letters;
  }

  @Get()
  async query(@Req() request: Request): Promise<ContactDto[]> {
    return (await this.contactService.findByUser(request.user.uuid)).map(toContactDto);
  }

  @Get(':uuid')
  async queryOne(
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Req() request: Request,
  ): Promise<ContactDto> {
    const contact = await this.contactService.findOwnedOne(uuid, request.user.uuid);
    if (!contact) throw new NotFoundException('contact not found');
    return toContactDto(contact);
  }

  @Post()
  async create(
    @Body(new SchemaPipe(newContactSchema))
    createContact: {
      name: string;
      email?: string;
      phone?: string;
      note?: string;
      letterUuids?: string[];
    },
    @Req() request: Request,
  ): Promise<ContactDto> {
    const name = this.trimString(createContact.name);
    const email = this.normalizeOptionalValue(createContact.email);
    const phone = this.normalizeOptionalValue(createContact.phone);
    const note = this.normalizeOptionalValue(createContact.note);

    if (!name) throw new BadRequestException('name is required');
    this.ensureValidPayload({ email, phone });

    const user = await this.userService.findOne({
      uuid: request.user.uuid,
      iSdelete: 0,
    });
    if (!user) throw new NotFoundException('user not found');

    const letters = await this.resolveOwnedLetters(request.user.uuid, createContact.letterUuids);

    return toContactDto(
      await this.contactService.insert({
        name,
        email,
        phone,
        note,
        user,
        letters,
      }),
    );
  }

  @Put(':uuid')
  async update(
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Body(new SchemaPipe(updateContactSchema))
    updateContact: {
      expectedUpdatedAt?: string;
      name?: string;
      email?: string;
      phone?: string;
      note?: string;
      letterUuids?: string[];
    },
    @Req() request: Request,
  ): Promise<ContactDto> {
    const existing = await this.contactService.findOwnedOne(uuid, request.user.uuid);
    if (!existing) throw new NotFoundException('contact not found');

    const payload = {
      name: this.trimString(updateContact.name),
      email: this.normalizeOptionalValue(updateContact.email),
      phone: this.normalizeOptionalValue(updateContact.phone),
      note: this.normalizeOptionalValue(updateContact.note),
      letters: await this.resolveOwnedLetters(request.user.uuid, updateContact.letterUuids),
    };

    if (
      !payload.name &&
      payload.email === undefined &&
      payload.phone === undefined &&
      payload.note === undefined &&
      payload.letters === undefined
    ) {
      throw new BadRequestException('name, email, phone, note or letterUuids is required');
    }

    this.ensureValidPayload({
      email: payload.email === undefined ? existing.email : payload.email,
      phone: payload.phone === undefined ? existing.phone : payload.phone,
    });

    const updated = updateContact.expectedUpdatedAt
      ? await this.contactService.updateOwned(
          uuid,
          request.user.uuid,
          payload,
          updateContact.expectedUpdatedAt,
        )
      : await this.contactService.updateOwned(uuid, request.user.uuid, payload);
    if (!updated) throw new NotFoundException('contact not found');
    return toContactDto(updated);
  }

  @Delete(':uuid')
  @HttpCode(204)
  async remove(
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Req() request: Request,
  ): Promise<void> {
    const contact = await this.contactService.findOwnedOne(uuid, request.user.uuid);
    if (!contact) throw new NotFoundException('contact not found');
    await this.contactService.removeOwned(uuid, request.user.uuid);
  }
}
