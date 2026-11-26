import {
  ContactRound,
  FileText,
  HardDrive,
  Mail,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { AdminDashboard, DashboardData } from "../lib/api";
import {
  DashboardEmptyState,
  DashboardIdentity,
  DashboardMetric,
  DashboardPanel,
} from "../components/dashboard/DashboardCard";
import { Link } from "react-router-dom";
import { Button } from "../components/ui";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OverviewScreen(props: {
  dashboard: DashboardData;
  adminDashboard: AdminDashboard | null;
}) {
  const { dashboard, adminDashboard } = props;
  const latestLetter = dashboard.letters[0];
  const latestContact = dashboard.contacts[0];
  const username = dashboard.user?.username || "未命名用户";
  const email = dashboard.user?.email || "尚未配置邮箱";

  return (
    <section className="overview-stack">
      <header className="workspace-heading">
        <p className="ui-eyebrow">WORDS THAT STAY</p>
        <h2>把重要的话，留在这里。</h2>
        <p>不急着写完。想到什么，就先留下来。</p>
        <Button asChild>
          <Link to="/letters">打开我的信件</Link>
        </Button>
      </header>
      <div className="overview-primary-grid">
        <DashboardIdentity username={username} email={email} />
        <DashboardMetric label="我的信件" value={dashboard.letters.length} icon={Mail} />
        <DashboardMetric label="我的联系人" value={dashboard.contacts.length} icon={UserRound} />
      </div>

      {adminDashboard ? (
        <>
          <div className="overview-system-grid">
            <DashboardMetric
              compact
              label="用户总数"
              value={adminDashboard.totals.users}
              icon={UsersRound}
            />
            <DashboardMetric
              compact
              label="管理员"
              value={adminDashboard.totals.admins}
              icon={ShieldCheck}
            />
            <DashboardMetric
              compact
              label="系统信件"
              value={adminDashboard.totals.letters}
              icon={FileText}
            />
            <DashboardMetric
              compact
              label="系统联系人"
              value={adminDashboard.totals.contacts}
              icon={ContactRound}
            />
            <DashboardMetric
              compact
              label="资源占用"
              value={formatBytes(adminDashboard.totals.resourceBytes)}
              icon={HardDrive}
            />
          </div>

          <div className="overview-detail-grid">
            <DashboardPanel title="最近信件投递" icon={Mail}>
              {adminDashboard.recentLetters.length ? (
                <div className="dashboard-record-list">
                  {adminDashboard.recentLetters.map((letter) => (
                    <article className="dashboard-record" key={letter.uuid}>
                      <div>
                        <h4>信件 {letter.uuid.slice(0, 8)}</h4>
                        <p>
                          {letter.lastTriggeredAt
                            ? "已触发投递"
                            : letter.deliveryEnabled
                              ? "等待投递"
                              : "未启用投递"}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <DashboardEmptyState>暂无信件投递记录。</DashboardEmptyState>
              )}
            </DashboardPanel>

            <DashboardPanel title="角色分布" icon={ShieldCheck}>
              <div className="role-distribution">
                {adminDashboard.roleDistribution.map((item) => (
                  <article className="role-distribution-item" key={item.roleUuid}>
                    <div className="role-distribution-head">
                      <div>
                        <h4>{item.roleName}</h4>
                        <div className="chip-row">
                          {item.permissionNames.map((name) => (
                            <span className="chip" key={name}>
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span>{item.userCount} 位用户</span>
                    </div>
                    <div
                      className="role-distribution-track"
                      role="progressbar"
                      aria-label={`${item.roleName} 用户占比`}
                      aria-valuemin={0}
                      aria-valuemax={Math.max(adminDashboard.totals.users, 1)}
                      aria-valuenow={item.userCount}
                    >
                      <span
                        style={{
                          width: `${
                            adminDashboard.totals.users
                              ? (item.userCount / adminDashboard.totals.users) * 100
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </DashboardPanel>

            <DashboardPanel title="最近加入的用户" icon={UsersRound}>
              {adminDashboard.recentUsers.length ? (
                <div className="dashboard-record-list">
                  {adminDashboard.recentUsers.map((user) => (
                    <article className="dashboard-record" key={user.uuid}>
                      <span className="dashboard-record-avatar" aria-hidden="true">
                        {user.username.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                      <div>
                        <h4>{user.username}</h4>
                        <p>{user.email}</p>
                      </div>
                      <span className="dashboard-record-meta">{user.role?.name || "user"}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <DashboardEmptyState>暂时还没有可显示的用户。</DashboardEmptyState>
              )}
            </DashboardPanel>
          </div>
        </>
      ) : null}

      <div className="overview-detail-grid overview-latest-grid">
        <DashboardPanel title="最近一封信" icon={Mail}>
          {latestLetter ? (
            <article className="dashboard-highlight">
              <h4>{latestLetter.title}</h4>
              <p>
                {latestLetter.lastTriggeredAt
                  ? "已触发投递"
                  : latestLetter.deliveryEnabled
                    ? "等待投递"
                    : "尚未开启投递"}
              </p>
            </article>
          ) : (
            <DashboardEmptyState>
              还没有信件，可以先去“我的信件”创建第一条内容。
            </DashboardEmptyState>
          )}
        </DashboardPanel>

        <DashboardPanel title="最近联系人" icon={ContactRound}>
          {latestContact ? (
            <article className="dashboard-highlight">
              <h4>{latestContact.name}</h4>
              <p>{latestContact.displaySummary || "暂无联系方式"}</p>
            </article>
          ) : (
            <DashboardEmptyState>
              还没有联系人，可以在“我的联系人”页面开始维护关系网络。
            </DashboardEmptyState>
          )}
        </DashboardPanel>
      </div>
    </section>
  );
}
