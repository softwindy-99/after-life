import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "../ui";

export function AuthAtmosphere() {
  const [paused, setPaused] = useState(() => {
    try {
      return window.localStorage.getItem("after-life-ambient-paused") === "true";
    } catch {
      return false;
    }
  });
  function toggle(): void {
    const next = !paused;
    setPaused(next);
    try {
      window.localStorage.setItem("after-life-ambient-paused", String(next));
    } catch {
      /* Page-local preference still works with blocked storage. */
    }
  }
  return (
    <>
      <div className="auth-atmosphere" data-paused={paused || undefined} aria-hidden="true">
        <span className="auth-orbit auth-orbit-one" />
        <span className="auth-orbit auth-orbit-two" />
        <span className="auth-signal" />
        <span className="auth-grid-line" />
      </div>
      <Button
        className="auth-motion-toggle"
        size="sm"
        variant="ghost"
        aria-label="界面动态效果"
        aria-pressed={!paused}
        onClick={toggle}
      >
        {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}动态效果：
        {paused ? "关" : "开"}
      </Button>
    </>
  );
}
