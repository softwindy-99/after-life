import { type FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, UserRound } from "lucide-react";
import { Button, Field, Input } from "../components/ui";
import { TerminalBrand, TerminalWordmark } from "../components/layout/TerminalBrand";
import { AuthAtmosphere } from "../components/layout/AuthAtmosphere";
import type { Notice } from "../types";

export function LoginScreen(props: {
  initialEmail: string;
  loading: boolean;
  checking?: boolean;
  notice: Notice;
  onRegister: (username: string, email: string, password: string) => Promise<void>;
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState(props.initialEmail);
  const [passwordVisible, setPasswordVisible] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      if (registering) {
        await props.onRegister(
          String(form.get("username") || ""),
          email,
          String(form.get("password") || ""),
        );
        setRegistering(false);
        setPasswordVisible(false);
        return;
      }
      await props.onLogin(String(form.get("email") || ""), String(form.get("password") || ""));
    } catch {
      /* App owns authentication feedback. */
    }
  }
  return (
    <main className="auth-shell auth-ambient">
      <header className="boot-topline">
        <TerminalBrand />
        <span>PERSONAL TERMINAL / 登录</span>
      </header>
      <div className="auth-body">
        <section>
          <p className="ui-eyebrow">WORDS THAT STAY</p>
          <TerminalWordmark />
          <h1 className="boot-description">留一些话，给重要的人。</h1>
          <div className="boot-rule" aria-hidden="true" />
        </section>
        <form
          className="auth-form page-transition"
          onSubmit={handleSubmit}
          key={registering ? "register" : "login"}
          aria-label={registering ? "注册 After Life" : "登录 After Life"}
        >
          <div>
            <p className="ui-eyebrow">ACCESS / 个人空间</p>
            <h2>{registering ? "创建日常账户" : "登录 After Life"}</h2>
          </div>
          {!registering && props.initialEmail && (
            <div className="login-account-hint">
              <UserRound aria-hidden="true" size={18} />
              <p>已填入刚创建的日常账户邮箱。管理员账号用于系统维护。</p>
            </div>
          )}
          {registering && (
            <Field label="账户名称">
              <Input
                name="username"
                autoComplete="nickname"
                maxLength={50}
                required
                disabled={props.loading}
              />
            </Field>
          )}
          <Field label="邮箱">
            <Input
              name="email"
              type="email"
              value={email}
              autoCapitalize="none"
              autoComplete="email"
              maxLength={50}
              placeholder="you@example.com"
              required
              spellCheck={false}
              disabled={props.loading || props.checking}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <div className="ui-field">
            <label className="ui-field-label" htmlFor="login-password">
              密码
              <span className="ui-required" aria-hidden="true">
                {" "}
                *
              </span>
            </label>
            <div className="password-control">
              <Input
                id="login-password"
                name="password"
                type={passwordVisible ? "text" : "password"}
                autoComplete={registering ? "new-password" : "current-password"}
                minLength={registering ? 8 : undefined}
                maxLength={registering ? 128 : undefined}
                placeholder="请输入密码"
                required
                disabled={props.loading || props.checking}
              />
              <Button
                variant="ghost"
                size="icon"
                disabled={props.loading || props.checking}
                aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((visible) => !visible)}
              >
                {passwordVisible ? (
                  <EyeOff aria-hidden="true" size={17} />
                ) : (
                  <Eye aria-hidden="true" size={17} />
                )}
              </Button>
            </div>
          </div>
          {props.notice && (
            <div
              className={`notice notice-${props.notice.tone}`}
              role={props.notice.tone === "error" ? "alert" : "status"}
            >
              {props.notice.text}
            </div>
          )}
          <Button busy={props.loading} disabled={props.checking} type="submit" size="lg">
            {registering ? "注册账户" : props.loading ? "正在登录" : "进入我的空间"}
            <ArrowRight aria-hidden="true" size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={props.loading || props.checking}
            onClick={() => {
              setPasswordVisible(false);
              setRegistering(!registering);
            }}
          >
            {registering ? "返回登录" : "创建账户"}
          </Button>
          <p className="auth-form-note" role={props.checking ? "status" : undefined}>
            {props.checking ? "正在确认服务状态…" : "管理你的信件、联系人和日常签到。"}
          </p>
        </form>
      </div>
      <footer className="boot-bottomline">
        <span>AFTER LIFE / PERSONAL SPACE</span>
        <span>连接此刻与未来</span>
      </footer>
      <AuthAtmosphere />
    </main>
  );
}
