import { deliveryPreviewSchema, newLetterSchema, updateLetterSchema } from './letter.schema';

describe('Letter HTTP schemas', () => {
  it('accepts the empty inactivity field submitted by disabled web drafts', () => {
    expect(
      newLetterSchema.parse({
        title: 'Draft',
        content: '<p>Test</p>',
        deliveryEnabled: false,
        inactiveAfterMinutes: '',
      }).inactiveAfterMinutes,
    ).toBeNull();
    expect(
      updateLetterSchema.parse({ deliveryEnabled: false, inactiveAfterMinutes: '' })
        .inactiveAfterMinutes,
    ).toBeNull();
  });

  it('still rejects invalid nonempty inactivity values', () => {
    for (const inactiveAfterMinutes of ['abc', '0', -1]) {
      expect(updateLetterSchema.safeParse({ inactiveAfterMinutes }).success).toBe(false);
    }
  });

  it('requires a positive preview timeout and actual update fields rather than review metadata alone', () => {
    expect(
      deliveryPreviewSchema.safeParse({ title: 'Hello', content: '<p>Body</p>' }).success,
    ).toBe(false);
    expect(updateLetterSchema.safeParse({ deliveryPreviewToken: 'review' }).success).toBe(false);
    expect(
      updateLetterSchema.safeParse({ expectedUpdatedAt: new Date().toISOString() }).success,
    ).toBe(false);
  });
});
