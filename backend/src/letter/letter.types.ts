import type { Contact } from 'src/contact/contact.entity';
import type { User } from 'src/user/user.entity';

export interface NewLetter {
  title: string;
  content: string;
  contentFormat?: string;
  excerpt?: string;
  coverResourceUuid?: string | null;
  resourceCount?: number;
  extra?: Record<string, unknown> | null;
  deliveryEnabled?: boolean;
  inactiveAfterMinutes?: number | null;
  contacts?: Pick<Contact, 'uuid'>[];
  user: Pick<User, 'uuid'>;
}

export interface UpdateLetter {
  title?: string;
  content?: string;
  contentFormat?: string;
  excerpt?: string;
  coverResourceUuid?: string | null;
  resourceCount?: number;
  extra?: Record<string, unknown> | null;
  deliveryEnabled?: boolean;
  inactiveAfterMinutes?: number | null;
  contacts?: Pick<Contact, 'uuid'>[];
  lastTriggeredAt?: Date | null;
}

export interface NewMcpLetterDraft {
  title: string;
  content: string;
  contentFormat?: string;
  inactiveAfterMinutes?: number | null;
  contactUuids?: string[];
}

export interface UpdateMcpLetterDraft {
  title?: string;
  content?: string;
  contentFormat?: string;
  inactiveAfterMinutes?: number | null;
  contactUuids?: string[];
}
