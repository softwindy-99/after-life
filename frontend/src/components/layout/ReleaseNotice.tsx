import { useEffect, useState } from "react";
import { version } from "../../../package.json";

const repository = "softwindy-99/after-life";
const interval = 6 * 60 * 60 * 1000;

function newerVersion(tag: string): boolean {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\w.-]+)?$/.exec(tag);
  if (!match) return false;
  const installed = version.split(".").map(Number);
  for (const [index, part] of match.slice(1).entries()) {
    const difference = Number(part) - installed[index];
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export function ReleaseNotice() {
  const [tag, setTag] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      try {
        const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) return;
        const release = await response.json();
        if (!controller.signal.aborted) {
          const available =
            !release.draft &&
            !release.prerelease &&
            typeof release.tag_name === "string" &&
            newerVersion(release.tag_name);
          setTag(available ? release.tag_name : "");
        }
      } catch {
        // A failed update check should not interrupt the admin session.
      }
    }
    void check();
    const timer = window.setInterval(check, interval);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  if (!tag) return null;
  return (
    <p role="status">
      发现新版本 {tag}（当前版本 {version}）。{" "}
      <a
        href={`https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`}
        target="_blank"
        rel="noreferrer"
      >
        查看更新说明
      </a>
    </p>
  );
}
