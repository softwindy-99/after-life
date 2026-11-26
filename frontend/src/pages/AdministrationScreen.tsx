import { Link } from "react-router-dom";
import type { AdminDashboard, DashboardData } from "../lib/api";
import { OverviewScreen } from "./OverviewScreen";

export function AdministrationScreen(props: {
  dashboard: DashboardData;
  adminDashboard: AdminDashboard | null;
}) {
  return (
    <section className="overview-stack">
      <div className="panel">
        <h3>系统管理</h3>
        <p>选择需要管理的功能，或返回我的空间继续日常使用。</p>
        <div className="chip-row">
          <Link className="chip" to="/mail">
            邮件服务
          </Link>
          <Link className="chip" to="/settings">
            系统设置
          </Link>
          <Link className="chip" to="/users">
            用户管理
          </Link>
          <Link className="chip" to="/roles">
            角色权限
          </Link>
          <Link className="chip" to="/">
            返回我的空间
          </Link>
        </div>
      </div>
      <OverviewScreen {...props} />
    </section>
  );
}
