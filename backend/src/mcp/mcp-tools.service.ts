import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CheckInService } from 'src/check-in/check-in.service';
import { Contact } from 'src/contact/contact.entity';
import { ContactService } from 'src/contact/contact.service';
import { Letter } from 'src/letter/letter.entity';
import { LetterService } from 'src/letter/letter.service';
import { User } from 'src/user/user.entity';
import { UserService } from 'src/user/user.service';
import {
  CreateMcpContactInput,
  CreateMcpLetterDraftInput,
  McpCheckIn,
  McpContactDetail,
  McpContactSummary,
  McpLetterDetail,
  McpLetterSummary,
  McpPage,
  McpProfile,
  UpdateMcpContactInput,
  UpdateMcpLetterDraftInput,
} from './mcp.types';

const MCP_LETTER_CONTENT_MAX_LENGTH = 20_000;
const MCP_RELATION_MAX_ITEMS = 100;

@Injectable()
export class McpToolsService {
  constructor(
    private readonly userService: UserService,
    private readonly contactService: ContactService,
    private readonly letterService: LetterService,
    private readonly checkInService: CheckInService,
  ) {}

  async getProfile(userUuid: string): Promise<{ profile: McpProfile }> {
    const user = await this.requireUser(userUuid);
    return {
      profile: {
        uuid: user.uuid,
        username: user.username,
        email: user.email,
        roleName: user.role?.name ?? null,
      },
    };
  }

  async listContacts(
    userUuid: string,
    page: number,
    pageSize: number,
  ): Promise<McpPage<McpContactSummary>> {
    const result = await this.contactService.findPageByUser(userUuid, page, pageSize);
    return this.toPage(
      result.data.map(({ contact, linkedLetterCount }) =>
        this.toContactSummary(contact, linkedLetterCount),
      ),
      result.total,
      page,
      pageSize,
    );
  }

  async getContact(userUuid: string, contactUuid: string): Promise<{ contact: McpContactDetail }> {
    const record = await this.requireContactRecord(userUuid, contactUuid);
    return { contact: this.toContactDetail(record) };
  }

  async createContact(
    userUuid: string,
    input: CreateMcpContactInput,
  ): Promise<{ contact: McpContactDetail }> {
    if (!input.email && !input.phone) {
      throw new BadRequestException('at least one contact method is required: email or phone');
    }

    const user = await this.requireUser(userUuid);
    const contact = await this.contactService.insert({
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      note: input.note ?? null,
      user,
      letters: [],
    });

    return {
      contact: this.toContactDetail({
        contact,
        linkedLetterCount: 0,
        letterUuidsTruncated: false,
      }),
    };
  }

  async updateContact(
    userUuid: string,
    contactUuid: string,
    input: UpdateMcpContactInput,
    allowEnabledDeliveryChanges = false,
  ): Promise<{ contact: McpContactDetail }> {
    const updated = await this.contactService.updateOwnedForMcp(
      contactUuid,
      userUuid,
      input.expectedUpdatedAt,
      {
        name: input.name,
        email: input.email,
        phone: input.phone,
        note: input.note,
      },
      allowEnabledDeliveryChanges,
    );
    if (!updated) throw new NotFoundException('contact not found');
    const record = await this.requireContactRecord(userUuid, updated.uuid);
    return { contact: this.toContactDetail(record) };
  }

  async listLetters(
    userUuid: string,
    page: number,
    pageSize: number,
  ): Promise<McpPage<McpLetterSummary>> {
    const result = await this.letterService.findPageByUser(userUuid, page, pageSize);
    return this.toPage(
      result.data.map(({ letter, contactCount }) => this.toLetterSummary(letter, contactCount)),
      result.total,
      page,
      pageSize,
    );
  }

  async getLetter(
    userUuid: string,
    letterUuid: string,
    includeContacts = true,
  ): Promise<{ letter: McpLetterDetail }> {
    const record = await this.requireLetterRecord(userUuid, letterUuid);
    const letter = this.toLetterDetail(record);
    if (!includeContacts) {
      letter.contacts = [];
      letter.contactsTruncated = record.contactCount > 0;
    }
    return { letter };
  }

  async createLetterDraft(
    userUuid: string,
    input: CreateMcpLetterDraftInput,
  ): Promise<{ letter: McpLetterDetail }> {
    const letter = await this.letterService.insertDraftForMcp(userUuid, {
      title: input.title,
      content: input.content,
      contentFormat: input.contentFormat,
      inactiveAfterMinutes: input.inactiveAfterMinutes ?? null,
      contactUuids: input.contactUuids,
    });

    const record = await this.requireLetterRecord(userUuid, letter.uuid);
    return { letter: this.toLetterDetail(record) };
  }

  async updateLetterDraft(
    userUuid: string,
    letterUuid: string,
    input: UpdateMcpLetterDraftInput,
  ): Promise<{ letter: McpLetterDetail }> {
    const updated = await this.letterService.updateOwnedDraftForMcp(
      letterUuid,
      userUuid,
      input.expectedUpdatedAt,
      {
        title: input.title,
        content: input.content,
        contentFormat: input.contentFormat,
        inactiveAfterMinutes: input.inactiveAfterMinutes,
        contactUuids: input.contactUuids,
      },
    );
    if (!updated) throw new NotFoundException('letter not found');
    const record = await this.requireLetterRecord(userUuid, updated.uuid);
    return { letter: this.toLetterDetail(record) };
  }

  async getCheckInStatus(userUuid: string): Promise<{
    lastSeenAt: string | null;
    checkIn: McpCheckIn | null;
  }> {
    const status = await this.checkInService.getStatus(userUuid);
    return {
      lastSeenAt: status.lastSeenAt ? this.toIso(status.lastSeenAt) : null,
      checkIn: status.checkIn
        ? {
            uuid: status.checkIn.uuid,
            checkedAt: this.toIso(status.checkIn.checkedAt),
            source: status.checkIn.source ?? null,
          }
        : null,
    };
  }

  private async requireUser(userUuid: string): Promise<User> {
    const user = await this.userService.findOne({ uuid: userUuid, iSdelete: 0 });
    if (!user) throw new NotFoundException('user not found');
    return user;
  }

  private async requireContactRecord(userUuid: string, contactUuid: string) {
    const record = await this.contactService.findOwnedOneForMcp(
      contactUuid,
      userUuid,
      MCP_RELATION_MAX_ITEMS,
    );
    if (!record) throw new NotFoundException('contact not found');
    return record;
  }

  private async requireLetterRecord(userUuid: string, letterUuid: string) {
    const record = await this.letterService.findOwnedOneForMcp(
      letterUuid,
      userUuid,
      MCP_RELATION_MAX_ITEMS,
    );
    if (!record) throw new NotFoundException('letter not found');
    return record;
  }

  private toContactSummary(contact: Contact, linkedLetterCount: number): McpContactSummary {
    return {
      uuid: contact.uuid,
      name: contact.name,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      linkedLetterCount,
      createdAt: this.toIso(contact.createdAt),
      updatedAt: this.toIso(contact.updatedAt),
    };
  }

  private toContactDetail(record: {
    contact: Contact;
    linkedLetterCount: number;
    letterUuidsTruncated: boolean;
  }): McpContactDetail {
    const { contact, linkedLetterCount, letterUuidsTruncated } = record;
    return {
      ...this.toContactSummary(contact, linkedLetterCount),
      note: contact.note ?? null,
      letterUuids: (contact.letters ?? [])
        .filter((letter) => letter.iSdelete !== 1)
        .map((letter) => letter.uuid),
      letterUuidsTruncated,
    };
  }

  private toLetterSummary(letter: Letter, contactCount: number): McpLetterSummary {
    return {
      uuid: letter.uuid,
      title: letter.title,
      excerpt: letter.excerpt,
      contentFormat: letter.contentFormat,
      deliveryEnabled: Boolean(letter.deliveryEnabled),
      inactiveAfterMinutes: letter.inactiveAfterMinutes ?? null,
      contactCount,
      createdAt: this.toIso(letter.createdAt),
      updatedAt: this.toIso(letter.updatedAt),
    };
  }

  private toLetterDetail(record: {
    letter: Letter;
    contactCount: number;
    contactsTruncated: boolean;
  }): McpLetterDetail {
    const { letter, contactCount, contactsTruncated } = record;
    const contentTruncated = letter.content.length > MCP_LETTER_CONTENT_MAX_LENGTH;
    return {
      ...this.toLetterSummary(letter, contactCount),
      content: contentTruncated
        ? letter.content.slice(0, MCP_LETTER_CONTENT_MAX_LENGTH)
        : letter.content,
      contentTruncated,
      lastTriggeredAt: letter.lastTriggeredAt ? this.toIso(letter.lastTriggeredAt) : null,
      contacts: (letter.contacts ?? [])
        .filter((contact) => contact.iSdelete !== 1)
        .map((contact) => ({
          uuid: contact.uuid,
          name: contact.name,
          email: contact.email ?? null,
          phone: contact.phone ?? null,
        })),
      contactsTruncated,
    };
  }

  private toPage<T>(items: T[], total: number, page: number, pageSize: number): McpPage<T> {
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private toIso(value: Date): string {
    return value.toISOString();
  }
}
