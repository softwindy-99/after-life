import {
  CalendarCheck2,
  Bot,
  ContactRound,
  FileText,
  LayoutDashboard,
  Mail,
  Settings,
  ShieldCheck,
  UserCircle,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { usePersonalLayout } from "../../hooks/usePersonalLayout";
import { NavLink, useLocation } from "react-router-dom";

interface NavigationItem {
  label: string;
  userLabel?: string;
  icon: LucideIcon;
  to: string;
  adminOnly?: boolean;
}

const navigationItems: NavigationItem[] = [
  { label: "总览", icon: LayoutDashboard, to: "/" },
  { label: "每日签到", icon: CalendarCheck2, to: "/checkin" },
  { label: "信件管理", userLabel: "我的信件", icon: FileText, to: "/letters" },
  { label: "联系人管理", userLabel: "我的联系人", icon: ContactRound, to: "/contacts" },
  { label: "邮件服务", icon: Mail, to: "/mail", adminOnly: true },
  { label: "系统设置", icon: Settings, to: "/settings", adminOnly: true },
  { label: "用户管理", icon: UsersRound, to: "/users", adminOnly: true },
  { label: "角色权限", icon: ShieldCheck, to: "/roles", adminOnly: true },
  { label: "AI 接入", icon: Bot, to: "/mcp-settings" },
  { label: "个人资料", icon: UserCircle, to: "/profile" },
];

export function AppNavigation(props: { isAdmin: boolean; onNavigate: () => void }) {
  const personalLayout = usePersonalLayout();
  const { pathname } = useLocation();
  const inAdministration = ["/admin", "/mail", "/settings", "/users", "/roles"].includes(pathname);
  return (
    <nav className="nav" aria-label="主导航">
      {personalLayout && props.isAdmin && (
        <NavLink to={inAdministration ? "/" : "/admin"} onClick={props.onNavigate}>
          <ShieldCheck aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>{inAdministration ? "返回我的空间" : "系统管理"}</span>
        </NavLink>
      )}
      {navigationItems
        .filter((item) => {
          if (item.adminOnly && !props.isAdmin) return false;
          if (personalLayout && item.adminOnly && !inAdministration) return false;
          if (personalLayout && inAdministration && !item.adminOnly) return false;
          return true;
        })
        .map((item, index) => {
          const Icon = item.icon;
          const label =
            props.isAdmin && !personalLayout ? item.label : item.userLabel || item.label;
          return (
            <NavLink end={item.to === "/"} key={item.to} to={item.to} onClick={props.onNavigate}>
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{label}</span>
              <span className="nav-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
            </NavLink>
          );
        })}
    </nav>
  );
}
