import { schedulerInterval } from './scheduler-interval';

describe('scheduler interval configuration', () => {
  it.each([undefined, '', ' '])('defaults only missing settings: %s', (value) => {
    expect(schedulerInterval(value, 'TEST_INTERVAL')).toBe(60_000);
  });
  it.each(['-1', '0', '1', '999', '1.5', 'Infinity', 'NaN', '2147483648', '1e4'])(
    'rejects settings that could cause a tight timer loop: %s',
    (value) => {
      expect(() => schedulerInterval(value, 'TEST_INTERVAL')).toThrow(
        'TEST_INTERVAL must be an integer',
      );
    },
  );
  it.each([1000, 60_000, 2_147_483_647])('accepts bounded millisecond intervals: %s', (value) => {
    expect(schedulerInterval(String(value), 'TEST_INTERVAL')).toBe(value);
  });
});
