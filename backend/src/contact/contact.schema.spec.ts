import { newContactSchema, updateContactSchema } from './contact.schema';

describe('Contact HTTP schemas', () => {
  it('accepts blank optional fields sent as null by the web form', () => {
    expect(
      newContactSchema.parse({ name: 'Test', email: 'test@example.com', phone: null, note: null }),
    ).toEqual({ name: 'Test', email: 'test@example.com', phone: '', note: '' });
  });

  it('allows clearing optional fields without removing the required contact method', () => {
    expect(updateContactSchema.parse({ phone: null, note: null })).toEqual({ phone: '', note: '' });
    expect(newContactSchema.safeParse({ name: 'Test', email: null, phone: null }).success).toBe(
      false,
    );
  });
});
