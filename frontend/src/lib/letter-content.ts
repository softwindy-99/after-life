import { absoluteResourceUrl, fetchResourceAccess } from "./api";

const resourcePath = /^\/resource\/([0-9a-f-]{36})$/i;
const signedPath = /\/resource\/([0-9a-f-]{36})\/file$/i;
const tags = new Set([
  "P",
  "BR",
  "STRONG",
  "EM",
  "S",
  "U",
  "H2",
  "H3",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "CODE",
  "PRE",
  "A",
  "IMG",
  "HR",
]);

function safeUrl(value: string): boolean {
  if (resourcePath.test(value)) return true;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** 草稿和预览只保留邮件支持的结构；浏览器缓存也必须视为不可信输入。
 * Keep email-compatible markup; browser recovery data is untrusted input too. */
export function letterHtml(content: string, format = "html"): string {
  const template = document.createElement("template");
  if (format !== "html") {
    for (const [index, line] of content.split("\n").entries()) {
      if (index) template.content.append(document.createElement("br"));
      template.content.append(document.createTextNode(line));
    }
    return template.innerHTML;
  }
  template.innerHTML = content;
  for (const node of [...template.content.querySelectorAll("*")]) {
    if (!tags.has(node.tagName)) {
      if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG", "MATH"].includes(node.tagName))
        node.remove();
      else node.replaceWith(...node.childNodes);
      continue;
    }
    const attribute = node.tagName === "IMG" ? "src" : node.tagName === "A" ? "href" : null;
    const url = attribute ? node.getAttribute(attribute) : null;
    const alt = node.getAttribute("alt") || "";
    for (const name of node.getAttributeNames()) node.removeAttribute(name);
    if (attribute && url && safeUrl(url)) {
      node.setAttribute(attribute, url);
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      } else node.setAttribute("alt", alt);
    }
  }
  return template.innerHTML;
}

/** 持久化稳定资源引用，不把短期签名链接写进草稿或正式信件。
 * Persist stable resource references rather than expiring signed URLs. */
export function storedLetterHtml(html: string, format = "html"): string {
  const template = document.createElement("template");
  template.innerHTML = letterHtml(html, format);
  const apiOrigin = new URL(absoluteResourceUrl("/")).origin;
  for (const node of template.content.querySelectorAll("img[src], a[href]")) {
    const attribute = node.tagName === "IMG" ? "src" : "href";
    const value = node.getAttribute(attribute)!;
    const url = new URL(value, window.location.origin);
    const match = url.origin === apiOrigin && url.pathname.match(signedPath);
    if (match) node.setAttribute(attribute, `/resource/${match[1].toLowerCase()}`);
  }
  return template.innerHTML;
}

export async function resolveLetterHtml(
  content: string,
  format = "html",
  signal?: AbortSignal,
  preserveUnavailable = false,
): Promise<{ html: string; unavailable: number }> {
  const template = document.createElement("template");
  template.innerHTML = storedLetterHtml(content, format);
  const nodes = [...template.content.querySelectorAll("img[src], a[href]")];
  const uuids = [
    ...new Set(
      nodes.flatMap((node) => {
        const match = node
          .getAttribute(node.tagName === "IMG" ? "src" : "href")
          ?.match(resourcePath);
        return match ? [match[1].toLowerCase()] : [];
      }),
    ),
  ];
  const urls = new Map<string, string>();
  await Promise.all(
    uuids.map(async (uuid) => {
      try {
        const result = await fetchResourceAccess(uuid, signal);
        urls.set(uuid, absoluteResourceUrl(result.url));
      } catch (error) {
        if (signal?.aborted) throw error;
        // 保留正文，单独提示不可用附件；一个文件失败不应隐藏整封信。
        // A missing attachment must not hide the rest of the letter.
      }
    }),
  );
  for (const node of nodes) {
    const attribute = node.tagName === "IMG" ? "src" : "href";
    const match = node.getAttribute(attribute)?.match(resourcePath);
    if (!match) continue;
    const url = urls.get(match[1].toLowerCase());
    if (url) node.setAttribute(attribute, url);
    else if (preserveUnavailable) continue;
    else if (node.tagName === "IMG") node.replaceWith(document.createTextNode("[图片不可用]"));
    else node.removeAttribute(attribute);
  }
  return { html: template.innerHTML, unavailable: uuids.length - urls.size };
}

export function withoutPrivateAttachments(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = storedLetterHtml(html);
  for (const node of template.content.querySelectorAll("img[src], a[href]")) {
    if (!resourcePath.test(node.getAttribute(node.tagName === "IMG" ? "src" : "href") || ""))
      continue;
    node.replaceWith(
      document.createTextNode(
        `${node.getAttribute("alt") || node.textContent || "图片"}（需重新上传）`,
      ),
    );
  }
  return template.innerHTML;
}
