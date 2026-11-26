import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, X } from "lucide-react";
export type MessageNotice = { tone: "success" | "error"; text: string } | null;

export function Message(props: {
  notice: MessageNotice;
  onClose: () => void;
  durationMs?: number;
}) {
  const [paused, setPaused] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const durationMs = props.durationMs ?? (props.notice?.tone === "error" ? 0 : 5000);

  useEffect(() => {
    if (!props.notice) return;
    setPaused(false);
    // Feedback must remain visible and operable inside a modal's top layer.
    function updateContainer() {
      const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
      setContainer(dialogs.item(dialogs.length - 1) ?? document.body);
    }
    updateContainer();
    const observer = new MutationObserver(updateContainer);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => observer.disconnect();
  }, [props.notice]);

  useEffect(() => {
    if (!props.notice || durationMs <= 0 || paused) return;
    const timer = window.setTimeout(props.onClose, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, props.notice, props.onClose, paused]);

  if (!props.notice) return null;

  const isError = props.notice.tone === "error";
  const message = (
    <div
      className="ui-message-layer"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <div
        className={`ui-message ui-message-${props.notice.tone}`}
        role={isError ? "alert" : "status"}
        aria-atomic="true"
      >
        <span className="ui-message-icon" aria-hidden="true">
          {isError ? <CircleAlert size={19} /> : <CircleCheck size={19} />}
        </span>
        <span>{props.notice.text}</span>
        <button
          className="ui-message-close"
          type="button"
          aria-label="关闭提示"
          onClick={props.onClose}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
    </div>
  );
  return typeof document === "undefined"
    ? message
    : createPortal(message, container?.isConnected ? container : document.body);
}
