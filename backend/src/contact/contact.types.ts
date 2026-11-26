import type { Letter } from 'src/letter/letter.entity';
import type { User } from 'src/user/user.entity';

export interface NewContact {
  name: string;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  extra?: Record<string, unknown> | null;
  user: User;
  letters?: Letter[];
}

export interface UpdateContact {
  name?: string;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  extra?: Record<string, unknown> | null;
  letters?: Letter[];
}
