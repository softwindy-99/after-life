import { Letter } from './letter.entity';
export function toLetterDto(letter: Letter) {
  return {
    uuid: letter.uuid,
    title: letter.title,
    content: letter.content,
    contentFormat: letter.contentFormat,
    excerpt: letter.excerpt,
    deliveryEnabled: letter.deliveryEnabled,
    inactiveAfterMinutes: letter.inactiveAfterMinutes,
    lastTriggeredAt: letter.lastTriggeredAt,
    createdAt: letter.createdAt,
    updatedAt: letter.updatedAt,
    contacts: letter.contacts
      ?.filter((contact) => contact.iSdelete === 0)
      .map((contact) => ({ uuid: contact.uuid, name: contact.name, email: contact.email })),
  };
}
export type LetterDto = ReturnType<typeof toLetterDto>;
