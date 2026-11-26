import { useEffect, useState } from "react";
import type { DeliveryReview } from "../../lib/api";
import { Button, Dialog, Input } from "../ui";
import { formatDateTime } from "../../lib/format";

export function DeliveryReviewDialog(props: {
  review: DeliveryReview;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const { review } = props;
  const [expired, setExpired] = useState(() => Date.now() >= Date.parse(review.expiresAt));
  useEffect(() => {
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(review.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [review.expiresAt]);
  return (
    <Dialog
      open
      title="核对投递摘要"
      className="delivery-review-dialog"
      closeDisabled={props.busy}
      description="确认后保存信件并启用自动投递。预览本身不会签到或发送邮件。"
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <div className="dialog-body stack delivery-review-body">
        <dl className="delivery-facts">
          <div>
            <dt>计时起点</dt>
            <dd>
              {formatDateTime(review.baselineAt)}
              <small>
                {review.baselineSource === "check-in"
                  ? "最近一次签到"
                  : "账号创建时间（尚无签到记录）"}
              </small>
            </dd>
          </div>
          <div>
            <dt>预计触发</dt>
            <dd>
              {formatDateTime(review.dueAt)}
              <small>之后再次签到会重新计时；实际处理受调度与邮件服务状态影响。</small>
            </dd>
          </div>
          <div>
            <dt>私有附件</dt>
            <dd>{review.resourceCount} 个</dd>
          </div>
          <div>
            <dt>投递后保留</dt>
            <dd>
              {review.retentionDays} 天
              <small>全部收件人投递完成后开始计时，期满清理信件正文与附件。</small>
            </dd>
          </div>
        </dl>
        <div>
          <h4>实际收件人</h4>
          {review.recipients.length ? (
            <ul className="delivery-recipients">
              {review.recipients.map((contact) => (
                <li key={contact.uuid}>
                  <strong>{contact.name}</strong>
                  <span>{contact.email}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>暂无有效收件邮箱。</p>
          )}
        </div>
        {review.skippedContacts.length > 0 && (
          <p className="settings-hint">
            以下联系人没有邮箱，不会收到邮件：
            {review.skippedContacts.map((contact) => contact.name).join("、")}。
          </p>
        )}
        {review.blockers.map((blocker) => (
          <p key={blocker} className="notice notice-error" role="alert">
            {blocker}
          </p>
        ))}
        {expired && (
          <p className="notice notice-error" role="alert">
            摘要已到期，请返回编辑并重新核对。
          </p>
        )}
        {review.overdue && (
          <div className="delivery-overdue">
            <p>预计触发时间已经过去。确认启用后，系统可能在下一次调度时立即投递。</p>
            <label className="toggle-row">
              <Input
                type="checkbox"
                checked={acknowledged}
                disabled={props.busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              我已知晓启用后可能立即投递
            </label>
          </div>
        )}
      </div>
      <div className="dialog-footer">
        <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
          返回编辑
        </Button>
        <Button
          busy={props.busy}
          disabled={expired || !review.token || (review.overdue && !acknowledged)}
          onClick={props.onConfirm}
        >
          确认并保存
        </Button>
      </div>
    </Dialog>
  );
}
