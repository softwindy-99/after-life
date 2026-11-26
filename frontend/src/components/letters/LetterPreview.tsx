import { useEffect, useState } from "react";
import { Button, Spinner } from "../ui";
import { resolveLetterHtml } from "../../lib/letter-content";

export function LetterPreview(props: { content: string; contentFormat?: string }) {
  const [revision, setRevision] = useState(0);
  const source = `${props.contentFormat}:${props.content}`;
  const [result, setResult] = useState<{
    source: string;
    html: string;
    unavailable: number;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void resolveLetterHtml(props.content, props.contentFormat, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setResult({ source, ...next });
      })
      .catch(() => {
        // 取消后不回写旧页面。 / Never publish a cancelled preview into a newer page.
      });
    return () => controller.abort();
  }, [props.content, props.contentFormat, revision, source]);
  if (!result || result.source !== source) return <Spinner label="正在载入信件预览" />;
  return (
    <>
      {result.unavailable > 0 && (
        <p className="notice notice-error" role="alert">
          部分图片或附件暂时无法访问，正文仍可阅读。
        </p>
      )}
      {/* 内容经过标签与网址白名单处理，附件链接通过所有者认证重新签发。
          Markup is allowlisted and attachment URLs are renewed through owner authentication. */}
      <div
        className="letter-reading letter-rich-content"
        dangerouslySetInnerHTML={{ __html: result.html }}
      />
      {/\/resource\/[0-9a-f-]{36}/i.test(props.content) && (
        <Button size="sm" variant="ghost" onClick={() => setRevision((current) => current + 1)}>
          刷新附件链接
        </Button>
      )}
    </>
  );
}
