import { nextUpdatedAt } from './transaction';

describe('correspondence version timestamps', () => {
  afterEach(() => jest.restoreAllMocks());

  it('advances the version even when the local clock has moved backwards', () => {
    jest.spyOn(Date, 'now').mockReturnValue(100);
    expect(nextUpdatedAt(new Date(200)).getTime()).toBe(201);
  });

  it('uses the current time when it is newer than the stored version', () => {
    jest.spyOn(Date, 'now').mockReturnValue(200);
    expect(nextUpdatedAt(new Date(100)).getTime()).toBe(200);
  });
});
