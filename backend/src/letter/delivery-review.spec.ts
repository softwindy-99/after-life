import { ConflictException } from '@nestjs/common';
import {
  assertDeliveryReview,
  createDeliveryReview,
  DeliveryReviewSnapshot,
} from './delivery-review';

describe('delivery review consent', () => {
  const oldSecret = process.env.JWT_SECRET;
  const now = new Date('2026-11-15T08:00:00Z');
  const snapshot: DeliveryReviewSnapshot = {
    userUuid: 'owner',
    letterUuid: null,
    updatedAt: null,
    title: '给家人的信',
    content: '<p>一切安好</p>',
    inactiveAfterMinutes: 1440,
    baselineAt: now.toISOString(),
    baselineSource: 'check-in',
    contacts: [{ uuid: 'contact', name: '家人', email: 'family@example.test' }],
    resourceCount: 0,
    retentionDays: 30,
    mailConfigured: true,
    publicBaseUrl: '',
  };
  beforeEach(() => {
    process.env.JWT_SECRET = 'review-unit-test-secret';
    jest.useFakeTimers().setSystemTime(now);
  });
  afterEach(() => {
    jest.useRealTimers();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });

  it('calculates the actual deadline, skipped contacts and overdue state without mutating inputs', () => {
    const input = {
      ...snapshot,
      baselineSource: 'account-created' as const,
      baselineAt: '2026-11-01T08:00:00Z',
      contacts: [...snapshot.contacts, { uuid: 'no-email', name: '仅电话', email: null }],
    };
    const review = createDeliveryReview(input);
    expect(review).toMatchObject({
      dueAt: '2026-11-02T08:00:00.000Z',
      overdue: true,
      baselineSource: 'account-created',
      recipients: snapshot.contacts,
      skippedContacts: [{ uuid: 'no-email', name: '仅电话', email: null }],
      retentionDays: 30,
    });
    expect(input.contacts).toHaveLength(2);
    expect(() => assertDeliveryReview(review.token!, input)).not.toThrow();
    expect(JSON.stringify(review)).not.toContain(snapshot.content);
  });

  it.each([
    { title: '另一个标题' },
    { content: '<p>改过的正文</p>' },
    { userUuid: 'other-owner' },
    { letterUuid: 'other-letter' },
    { updatedAt: now.toISOString() },
    { baselineAt: '2026-11-15T08:01:00Z' },
    { inactiveAfterMinutes: 1 },
    { contacts: [{ uuid: 'contact', name: '家人', email: 'changed@example.test' }] },
    { resourceCount: 1 },
    { retentionDays: 7 },
    { mailConfigured: false },
  ])('invalidates consent after an input changes: %j', (change) => {
    const review = createDeliveryReview(snapshot);
    expect(() => assertDeliveryReview(review.token!, { ...snapshot, ...change })).toThrow(
      ConflictException,
    );
  });

  it('rejects missing, forged and expired reviews', () => {
    const review = createDeliveryReview(snapshot);
    for (const token of [undefined, 'invalid', review.token!.replace(/.$/, 'x')])
      expect(() => assertDeliveryReview(token, snapshot)).toThrow(ConflictException);
    jest.advanceTimersByTime(600_000);
    expect(() => assertDeliveryReview(review.token!, snapshot)).toThrow(ConflictException);
  });

  it('requires a new overdue review if the deadline passes while the confirmation is open', () => {
    const soon = { ...snapshot, inactiveAfterMinutes: 1 };
    const review = createDeliveryReview(soon);
    expect(review.overdue).toBe(false);
    jest.advanceTimersByTime(60_000);
    expect(() => assertDeliveryReview(review.token!, soon)).toThrow(ConflictException);
    expect(createDeliveryReview(soon).overdue).toBe(true);
  });

  it('withholds consent when recipients, SMTP or a private resource base URL are unavailable', () => {
    expect(
      createDeliveryReview({ ...snapshot, contacts: [], mailConfigured: false }).blockers,
    ).toHaveLength(2);
    expect(createDeliveryReview({ ...snapshot, resourceCount: 1 }).token).toBeNull();
    expect(
      createDeliveryReview({
        ...snapshot,
        resourceCount: 1,
        publicBaseUrl: 'https://letters.example.test/api',
      }).token,
    ).not.toBeNull();
  });
});
