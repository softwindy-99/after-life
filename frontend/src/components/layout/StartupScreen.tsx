import type { CSSProperties } from "react";
import type { StartupPhase } from "../../hooks/useStartupSequence";
import { Button, Progress } from "../ui";
import { TerminalBrand } from "./TerminalBrand";

const messages: Record<StartupPhase, string> = {
  connecting: "连接服务，确认系统入口。",
  calibrating: "服务已响应，正在展开入口。",
  loading: "正在载入入口界面。",
  ready: "入口已就绪，准备进入。",
};
const stages: StartupPhase[] = ["connecting", "calibrating", "loading", "ready"];
const channels = [
  { code: "SERVICE LINK", name: "服务连接", pending: "等待响应", active: "连接中", done: "已确认" },
  { code: "DISPLAY SYNC", name: "显示同步", pending: "待命", active: "同步中", done: "已同步" },
  { code: "INTERFACE", name: "入口界面", pending: "待命", active: "载入中", done: "已展开" },
  { code: "ENTRY ACCESS", name: "准备进入", pending: "等待", active: "已就绪", done: "已就绪" },
];
const readouts = ["WAITING FOR SIGNAL", "SIGNAL ACQUIRED", "DISPLAY SYNC COMPLETE", "ENTRY ONLINE"];

export function StartupScreen(props: {
  phase: StartupPhase;
  checking: boolean;
  holdMode: boolean;
  held: boolean;
  error: string;
  onRetry: () => void;
  onSkip: () => void;
  onReplay: () => void;
  onContinue: () => void;
}) {
  const failed = Boolean(props.error);
  const step = stages.indexOf(props.phase);
  return (
    <main
      className="boot-screen startup-screen"
      data-phase={props.phase}
      data-failed={failed || undefined}
      data-held={props.held || undefined}
      aria-busy={!failed && !props.held}
    >
      <div className="startup-hud" aria-hidden="true">
        <span className="startup-hud-corner" />
        <span className="startup-hud-corner" />
        <span className="startup-hud-corner" />
        <span className="startup-hud-corner" />
        <span className="startup-hud-axis" />
      </div>
      <header className="boot-topline">
        <TerminalBrand />
        <span>PERSONAL SYSTEM / WAKE SEQUENCE</span>
      </header>
      <div className="startup-body">
        <section className="boot-status startup-status" aria-label="系统启动">
          <div className="startup-kicker" aria-hidden="true">
            <span className="startup-kicker-chip">AF / OS</span>
            <span>INITIALIZING PERSONAL INTERFACE</span>
            <span className="startup-kicker-index">0{step + 1} / 04</span>
          </div>
          <div className="startup-wordmark" data-text="AFTER LIFE" aria-hidden="true">
            AFTER LIFE
          </div>
          <p className="ui-eyebrow startup-heading">STARTUP / 系统启动</p>
          <div className="startup-console">
            <div className="startup-console-head" aria-hidden="true">
              <span>INTERFACE CHECK / 界面自检</span>
              <span className="startup-console-state">
                {failed ? "SIGNAL LOST" : readouts[step]}
              </span>
            </div>
            <ol className="startup-steps" aria-label="启动阶段">
              {channels.map((channel, index) => {
                const state = failed
                  ? index === 0
                    ? "error"
                    : "pending"
                  : step > index || props.phase === "ready"
                    ? "complete"
                    : step === index
                      ? "active"
                      : "pending";
                const label = failed
                  ? index === 0
                    ? "连接失败"
                    : "已暂停"
                  : state === "complete"
                    ? channel.done
                    : state === "active"
                      ? channel.active
                      : channel.pending;
                return (
                  <li
                    key={channel.code}
                    data-state={state}
                    style={{ "--channel-index": index } as CSSProperties}
                  >
                    <span className="startup-channel-index">0{index + 1}</span>
                    <span className="startup-channel-name">
                      <span>{channel.code}</span>
                      <span>{channel.name}</span>
                    </span>
                    <span className="startup-channel-meter" aria-hidden="true">
                      {Array.from({ length: 10 }, (_, segment) => (
                        <i key={segment} style={{ "--segment-index": segment } as CSSProperties} />
                      ))}
                    </span>
                    <small>{label}</small>
                  </li>
                );
              })}
            </ol>
            <div className="startup-readout">
              <div
                className="startup-log"
                role="log"
                aria-label="启动终端输出"
                aria-live="polite"
                aria-relevant="additions text"
              >
                <div className="startup-log-track" key={`${props.phase}-${failed}`}>
                  {(failed ? [props.phase] : stages.slice(0, step + 1)).map(
                    (stage, index, entries) => {
                      const current = index === entries.length - 1;
                      const message = failed ? "暂时无法连接服务" : messages[stage];
                      return (
                        <div
                          className="startup-log-line"
                          data-current={current || undefined}
                          key={stage}
                        >
                          <span className="startup-log-code" aria-hidden="true">
                            &gt;{" "}
                            {failed ? "CONNECTION INTERRUPTED" : readouts[stages.indexOf(stage)]}
                          </span>
                          {current ? <h1>{message}</h1> : <p>{message}</p>}
                          {current && <span className="startup-cursor" aria-hidden="true" />}
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
              <span className="startup-readout-mode" aria-hidden="true">
                {failed
                  ? "RETRY AVAILABLE"
                  : props.phase === "ready"
                    ? "READY TO ENTER"
                    : "STANDBY"}
              </span>
            </div>
            <span key={props.phase} className="startup-sweep" aria-hidden="true" />
          </div>
          {failed ? (
            <p className="startup-error" role="alert">
              {props.error}
            </p>
          ) : (
            <Progress label="启动入口" value={props.held ? 100 : undefined} />
          )}
          <div className="startup-actions">
            {failed ? (
              <Button onClick={props.onRetry}>重新连接</Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={props.checking}
                  onClick={props.held ? props.onReplay : props.onSkip}
                >
                  {props.held ? "重新播放" : props.holdMode ? "跳到结束画面" : "跳过动画"}
                </Button>
                {props.held && <Button onClick={props.onContinue}>继续进入</Button>}
              </>
            )}
            <span aria-live="polite">
              {failed
                ? "连接恢复后可以继续"
                : props.held
                  ? "已停留在结束画面，可进行标注"
                  : props.holdMode
                    ? "标注预览：播放结束后停留"
                    : "此浏览器已播放后将自动跳过"}
            </span>
          </div>
        </section>
      </div>
      <footer className="boot-bottomline">
        <span>WORDS THAT STAY</span>
        <span>连接此刻与未来</span>
      </footer>
    </main>
  );
}
