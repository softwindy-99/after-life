// Node clamps negative and overflowing delays to approximately one millisecond.
// Reject invalid operator settings before creating timers or starting any work.
export function schedulerInterval(value: string | undefined, name: string): number {
  if (value === undefined || value.trim() === '') return 60_000;
  const milliseconds = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 1_000 ||
    milliseconds > 2_147_483_647
  ) {
    throw new Error(`${name} must be an integer between 1000 and 2147483647 milliseconds.`);
  }
  return milliseconds;
}
