import { Contact } from './contact.entity';
export function toContactDto(contact: Contact) {
  return {
    uuid: contact.uuid,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    note: contact.note,
    displaySummary: contact.displaySummary,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    letters: contact.letters
      ?.filter((letter) => letter.iSdelete === 0)
      .map((letter) => ({ uuid: letter.uuid, title: letter.title })),
  };
}
export type ContactDto = ReturnType<typeof toContactDto>;
