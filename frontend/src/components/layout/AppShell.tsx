import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogOut, Menu, UserRound } from "lucide-react";
import { NavLink } from "react-router-dom";
import { usePersonalLayout } from "../../hooks/usePersonalLayout";
import { pageTitle } from "../../lib/format";
import type { Notice } from "../../types";
import { Button, Dialog, Message } from "../ui";
import { AppNavigation } from "./AppNavigation";
import { TerminalBrand } from "./TerminalBrand";

export function AppShell(props: {
  pathname: string;
  username?: string;
  isAdmin: boolean;
  notice: Notice;
  onNoticeClose: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const personalLayout = usePersonalLayout();
  const inAdministration = ["/admin", "/mail", "/settings", "/users", "/roles"].includes(
    props.pathname,
  );
  const showAdminChrome = props.isAdmin && (!personalLayout || inAdministration);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousPath = useRef(props.pathname);
  const username = props.username || "未登录用户";
  const title = pageTitle(props.pathname, showAdminChrome);
  useEffect(() => {
    setNavigationOpen(false);
    document.title = `${title} · After Life`;
    if (previousPath.current === props.pathname) return;
    previousPath.current = props.pathname;
    const frame = window.requestAnimationFrame(() =>
      headingRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [props.pathname, title]);
  const footer = (
    <div className="sidebar-footer">
      {props.isAdmin && (
        <NavLink className="sidebar-kit" to="/ui-kit" onClick={() => setNavigationOpen(false)}>
          UI / 设计系统
        </NavLink>
      )}
      <Button
        variant="outline"
        onClick={() => {
          setNavigationOpen(false);
          props.onLogout();
        }}
      >
        <LogOut aria-hidden="true" size={16} />
        退出登录
      </Button>
    </div>
  );
  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>
      <aside className="sidebar">
        <div className="brand">
          <TerminalBrand />
          <p className="brand-subtitle">{showAdminChrome ? "系统管理" : "个人信件空间"}</p>
        </div>
        <AppNavigation isAdmin={props.isAdmin} onNavigate={() => setNavigationOpen(false)} />
        {footer}
      </aside>
      <Dialog
        open={navigationOpen}
        title="AFTER LIFE"
        className="navigation-dialog"
        onOpenChange={setNavigationOpen}
      >
        <AppNavigation isAdmin={props.isAdmin} onNavigate={() => setNavigationOpen(false)} />
        {footer}
      </Dialog>
      <main id="main-content" className="content" tabIndex={-1}>
        <header className="topbar">
          <div className="topbar-heading">
            <Button
              className="mobile-nav-trigger"
              variant="outline"
              size="icon"
              aria-expanded={navigationOpen}
              aria-haspopup="dialog"
              aria-label="打开导航"
              onClick={() => setNavigationOpen(true)}
            >
              <Menu aria-hidden="true" size={18} />
            </Button>
            <div>
              <p className="eyebrow">
                {showAdminChrome ? "SYSTEM / 系统管理" : "PERSONAL / 我的空间"}
              </p>
              <h1 ref={headingRef} tabIndex={-1}>
                {title}
              </h1>
            </div>
          </div>
          <NavLink className="topbar-meta" to="/profile" aria-label="打开个人资料">
            <span className="topbar-avatar" aria-hidden="true">
              {username.trim().charAt(0).toUpperCase() || "?"}
            </span>
            <span className="topbar-user">
              <strong>{username}</strong>
              <small>{props.isAdmin ? "管理员" : "日常账户"}</small>
            </span>
            <UserRound className="topbar-user-icon" aria-hidden="true" size={16} />
          </NavLink>
        </header>
        <Message notice={props.notice} onClose={props.onNoticeClose} />
        <div className="page-transition" key={props.pathname}>
          {props.children}
        </div>
        <footer className="terminal-footer">
          <span>
            <i className="brand-square" aria-hidden="true" />
            AFTER LIFE
          </span>
          <span>{showAdminChrome ? "SYSTEM MANAGEMENT" : "WORDS THAT STAY"}</span>
        </footer>
      </main>
    </div>
  );
}
