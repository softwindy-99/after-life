/** 摘要、邮件链接和清理任务必须使用相同的保留期限。
 * Reviews, signed mail links and cleanup must share the same retention policy. */
export function letterRetentionDays(): number {
  const days = Number(process.env.DELIVERED_LETTER_RETENTION_DAYS);
  return Number.isInteger(days) && days > 0 ? days : 30;
}
