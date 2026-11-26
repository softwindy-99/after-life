# After Life API 开发

NestJS + TypeORM + MySQL。源码、测试、依赖和构建产物位于 `backend/`，环境文件统一位于项目根目录；统一启动入口见[根目录 README](../README.md)。

## 命令

使用 Node.js 22.12+，以下命令在 `backend/` 执行：

| 命令                                    | 用途                                   |
| --------------------------------------- | -------------------------------------- |
| `npm install`                           | 安装依赖                               |
| `npm run dev`                           | 启动开发服务，默认端口 3000            |
| `npm run build` / `npm start`           | pro 构建 / test 运行 `dist/main.js`    |
| `npm run start:pro`                     | 使用 pro 配置运行生产 API              |
| `npm run lint` / `npm run format:check` | 代码与格式检查                         |
| `npm test`                              | 单元测试及覆盖率                       |
| `npm run test:e2e`                      | HTTP 回归测试                          |
| `npm run db -- --help`                  | 数据库工具帮助，不加载配置或连接数据库 |

单测与服务、控制器放在一起；跨模块 HTTP 测试位于 `test/`。HTTP 测试使用替代持久层，不连接 MySQL，不能验证真实迁移或锁竞争。完整检查在根目录执行 `npm run check`。

真实 MySQL 验证使用根目录 `npm run test:mysql`，或构建 API 后在本目录运行同名命令。它只使用 `DB_HOST/PORT/USER/PASSWORD` 连接参数（从根目录 `.env` 读取），忽略 `DB_NAME`，创建本次测试独有的随机数据库、执行迁移与事务测试，结束后删除该测试库；连接账号需具备建库与删库权限。测试附件写入系统临时目录，不运行应用 scheduler 或向外部发送邮件。

The MySQL integration check creates and drops only its own random test schema, never the configured application database. It verifies migrations, real user-lock serialization, review invalidation and attachment ownership without sending email.

## 配置与本地联调

配置文件统一在项目根目录，字段参考 [双语 env 示例](../.env.example)。可复制为 `.env`，或直接使用 Web 安装向导填写数据库和 `INIT_ADMIN_*` 管理员信息及首个普通账号。向导在同一事务中创建两个账号，保存配置后重新加载。账号密码不会写回文件。完成安装后，普通用户可通过 `POST /user` 注册，角色由服务端指定。管理用户、编辑角色权限及查看平台统计需要 `admin` 权限。

开发、测试和生产统一使用项目根目录 `.env`。每次 API 启动和应用内重载时，缺少文件会按 `.env.example` 创建；缺少键时仅追加示例默认值，保留已有值、空值和注释。安装、SMTP、推送代理和对象存储设置均写入该文件，权限为 `0600`。安装状态按文件中的数据库配置和签名密钥判定。

从旧版升级时，将原先使用的 `.env.dev`、`.env.test`、`.env.pro` 或部署环境中的有效配置迁入根目录 `.env`。如需隔离开发库和生产库，分别部署并维护各自的文件。

All launch modes, the setup wizard and the database CLI use the same root `.env`. Startup and reload fill missing keys from the template. Compose uses deployment variables such as `AFTER_LIFE_PORT` for host port mapping.

| 配置                                                                               | 开发时用途                                                              |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `PORT`                                                                             | API 端口，默认 3000；修改后同步前端 `VITE_API_PROXY_TARGET`             |
| `JWT_SECRET`                                                                       | JWT 与资源链接签名密钥，安装时生成                                      |
| `INIT_ADMIN_USERNAME`、`INIT_ADMIN_EMAIL`、`INIT_ADMIN_PASSWORD`                   | 安装及数据库 CLI 的管理员信息                                           |
| `MAIL_HOST`、`MAIL_PORT`、`MAIL_USER`、`MAIL_PASSWORD`、`MAIL_FROM`、`MAIL_SECURE` | SMTP；未配置时不自动投递                                                |
| `WEB_PUSH_PUBLIC_KEY`、`WEB_PUSH_PRIVATE_KEY`、`WEB_PUSH_SUBJECT`                  | Web Push VAPID 配置                                                     |
| `WEB_PUSH_PROXY`                                                                   | 推送代理；未设置时回退到 `HTTPS_PROXY` 或 `https_proxy`                 |
| `MCP_ALLOWED_ORIGINS`                                                              | 浏览器 MCP Origin 白名单，逗号分隔、精确匹配                            |
| `RESOURCE_STORAGE_DIR`                                                             | 私有资源目录，默认 `backend/.codex/resources`                           |
| `RESOURCE_STORAGE_DRIVER`                                                          | `local`（默认）、`s3` 或 `oss`                                          |
| `RESOURCE_STORAGE_ENDPOINT`、`RESOURCE_STORAGE_REGION`、`RESOURCE_STORAGE_BUCKET`  | 外部对象存储服务地址、区域和私有桶                                      |
| `RESOURCE_STORAGE_PREFIX`、`RESOURCE_STORAGE_FORCE_PATH_STYLE`                     | 对象前缀默认 `after-life`；S3 路径寻址默认 `true`                       |
| `RESOURCE_STORAGE_ACCESS_KEY_ID`、`RESOURCE_STORAGE_ACCESS_KEY_SECRET`             | 仅服务端使用的外部存储凭据                                              |
| `PUBLIC_BASE_URL`                                                                  | 邮件资源链接基础地址；发送本地资源需 HTTPS，部署构建产物时应包含 `/api` |
| `LETTER_STATUS_CHECK_INTERVAL_MS`、`NOTIFICATION_CHECK_INTERVAL_MS`                | 调度间隔，默认 60000 毫秒                                               |
| `DELIVERED_LETTER_RETENTION_DAYS`                                                  | 已投递信件保留天数，默认 30                                             |

不要提交 `.env.dev`、`.env.test`、`.env`、密钥或本地资源。调试邮件投递时只运行一个调度实例；SMTP 发送与结果落库之间存在崩溃后重复发送的窗口。

### 外部对象存储与迁移

系统设置 `/settings` 的「对象存储」支持连接测试、保存配置和迁移本地文件。`s3` 使用 AWS SDK v3，支持 MinIO 和标准 S3 API；`oss` 使用阿里云官方 `ali-oss` SDK 与 V4 签名（[官方初始化说明](https://www.alibabacloud.com/help/en/oss/initialization-10)）。先创建私有桶，赋予对象写入、读取和删除权限。无需公开桶或配置浏览器 CORS，上传、签名下载和清理均经 API，密钥不返回浏览器。

- MinIO 示例：`driver=s3`、`endpoint=https://minio.example.com`、`region=us-east-1`，路径模式 `true`。原生 S3 通常使用对应区域 endpoint 和虚拟主机模式。
- 阿里云示例：`driver=oss`、`endpoint=https://oss-cn-hangzhou.aliyuncs.com`、`region=cn-hangzhou`（也接受 `oss-cn-hangzhou`）。Endpoint 为服务地址，不包含桶名、路径、认证或查询参数。
- 先用「测试连接」完成临时对象写入、读取内容校验和删除，再保存配置。凭据留空保留当前值。配置写入根目录 `.env`。保存即时影响新上传，原有本地文件仍可读取。
- 「迁移本地文件」按每批最多 10 个依次执行，仅处理当前所有者的资源；每个文件取得用户锁后重新读取元数据，复制并下载验证 SHA-256，再提交存储位置。中断或失败时，已提交文件继续从外部读取，未提交文件仍从本地读取；刷新后可重试。链接、信件内容和资源 UUID 不变。
- 本地原件作为备份保留，迁移不会立即释放磁盘；确认外部文件和备份可用后可在维护窗口手动清理已迁移原件。正常资源过期清理会删除外部对象及残留本地原件。失败上传、连接测试或事务崩溃可能留下不被引用的外部对象，需由运维核对后清理。
- 存储配置对所有账号生效。修改配置时会短暂锁住账号，以等待进行中的上传或迁移完成。已有外部资源时，页面拒绝更换驱动、区域、桶、前缀或寻址方式，只允许轮换凭据；直接修改环境造成目标不匹配时访问会拒绝，避免读错对象。当前仅提供本地到所配置外部服务的迁移，不提供外部服务间搬迁或回迁。沿用单应用实例约束。

REST 接口仅开放给人类管理员会话：`GET/PUT /admin/storage`、`POST /admin/storage/test`、`POST /admin/storage/migrate`。状态只含配置摘要、凭据是否存在及当前所有者的本地/外部文件数量，不含文件正文、文件列表、密钥或本地路径；MCP 凭据不能调用。迁移接口返回 `{ migrated, remaining }`，调用方可逐批继续。

已有数据库升级需先审阅并显式执行 [ResourceStorage1740000000000](src/database/migrations/1740000000000-ResourceStorage.ts) 增量迁移，为旧资源标记默认本地位置。应用不自动迁移；外部资源存在时拒绝回退该迁移。

## Docker 部署

在仓库根目录执行 `docker compose up -d --build`，访问 `http://localhost:8080`。构建文件为根目录 [Dockerfile](../Dockerfile) 和 [compose.yaml](../compose.yaml)，运行配置位于 [docker/](../docker/)。镜像使用 Node.js 22 和 Ubuntu 24.04 提供的 MySQL 8.0。Nest 直接托管 `frontend/dist`，在 `/api` 下提供控制器。浏览器页面支持 SPA 回退，缺失的 API 和静态文件返回 404。

首次启动生成独立的随机 MySQL root 和应用密码，只创建空数据库与限定到 `after_life.*` 的应用账号。应用表、迁移和初始账号仍由安装向导显式初始化；后续启动不执行应用迁移、种子或重置。容器入口将内置数据库连接和附件目录的缺项写入配置卷中的 `.env`。首次部署时向导自动填入 `127.0.0.1:3306`、用户 `after_life` 和数据库 `after_life`，密码字段显示「已配置，留空使用现有密码」，实际密码不会返回浏览器。修改连接地址、端口、用户或库名后须重新提供密码。

容器只暴露 Nest 的 HTTP 端口 `3000`，MySQL 只监听容器内 `127.0.0.1:3306`。保持向导 API 端口为 `3000`，通过 `AFTER_LIFE_PORT` 调整宿主机 Web 端口。API 使用独立非 root 用户，初始化与进程管理由容器入口执行；任一服务意外退出会停止其余服务，由 Compose 重启整个容器。健康检查同时检查 MySQL、API 和前端，首次 MySQL 初始化可能需要一两分钟。用 `docker compose ps` 查看状态，`docker compose logs -f` 查看日志，`docker compose down` 停止并保留数据。只运行一个应用实例。

| 卷 / 路径                          | 保存内容                                    |
| ---------------------------------- | ------------------------------------------- |
| `mysql-data` → `/var/lib/mysql`    | MySQL 数据与应用表                          |
| `app-data` → `/var/lib/after-life` | `mysql.json` 数据库凭据与 `resources/` 附件 |
| `env-config` → `/etc/after-life`   | `.env` 运行配置                             |

容器内项目根目录 `/app/.env` 链接到持久化的 `/etc/after-life/.env`，文件由应用账号拥有，更新通过该链接保存到卷。新卷中缺少配置文件时，入口优先迁入配置卷中的旧 `.env.pro`，其次检查 `app-data` 卷中的 `.env.pro` 和 `config.env`，但数据库中的旧加密配置仍须按下文先迁出。请停止容器后一并备份三个卷，恢复时使用同一组备份；缺失凭据或数据库文件时，入口拒绝重新初始化已有数据。不要使用 `docker compose down -v`，它会删除这三个卷。升级前备份，再运行 `docker compose up -d --build`；已有数据库需要的新迁移仍须单独审阅和显式执行，运行镜像不包含开发用数据库 CLI。

正式部署时在容器前配置 HTTPS 反向代理，并在控制台设置 `PUBLIC_BASE_URL=https://你的域名/api`；Web Push 在生产环境需要 HTTPS。若要使用浏览器 MCP 客户端，设置精确的 `MCP_ALLOWED_ORIGINS`，MCP 入口为 `https://你的域名/api/mcp`。外部反向代理应支持流式响应并允许至少 11 MB 请求体；本地资源始终通过受控 API 访问，不挂载为静态目录。

## 代码入口与约定

| 入口                                                                                                 | 责任                                      |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [src/main.ts](src/main.ts)、[src/app.module.ts](src/app.module.ts)、[src/setup/](src/setup/)         | 启动、配置来源、安装与重载                |
| [src/auth/](src/auth/)、[src/permission/](src/permission/)                                           | 身份、会话和权限守卫                      |
| [src/correspondence/](src/correspondence/)、[src/letter/](src/letter/)、[src/contact/](src/contact/) | 信件、联系人、关系事务与投递              |
| [src/resource/](src/resource/)                                                                       | 私有上传、签名访问和清理                  |
| [src/check-in/](src/check-in/)、[src/notification/](src/notification/)                               | 签到、提醒与订阅                          |
| [src/mcp/](src/mcp/)、[src/database/](src/database/)                                                 | MCP 传输与工具、实体清单与迁移            |
| [src/agent/](src/agent/)                                                                             | 公开 Skill/CLI 分发、固定资源及完整下载包 |

控制器负责传输及运行时输入校验，服务负责业务和事务，响应显式映射安全 DTO。信件与联系人统一由 `CorrespondenceModule` 注册；REST 与 MCP 共用用户 → 按主键排序的联系人 → 信件的锁顺序，归属和投递检查必须在写事务内完成。

人类 REST 客户端使用 `POST /letter/delivery-preview` 获取投递摘要。请求包含完整的 HTML 信件草稿、收件人 UUID、未活跃分钟数；编辑已有信件时同时传 `letterUuid` 与 `expectedUpdatedAt`。摘要只读，不认领附件、不签到、不投递；返回有效收件人、计时起点、预计触发时间、私有附件数、保留期、阻碍条件及最长有效期为 10 分钟的确认令牌（未超时摘要在预计触发时刻提前失效）。启用或修改保持启用的信件时，`POST /letter` / `PUT /letter/:uuid` 必须带 `deliveryPreviewToken`。令牌与所有者、信件版本、正文、联系人、签到依据及投递配置绑定，在持有用户锁的写事务内重验；不匹配返回 409，需重新预览。未配置 SMTP、没有有效收件邮箱或私有附件缺少 HTTPS 访问地址时不能确认启用，但可以保存为未启用草稿。MCP 继续使用其独立权限及单次预览流程。

`GET /check-in/status` 除实际签到记录外返回 `baselineAt` / `baselineSource`；尚未签到时使用账号创建时间，与投递 worker 保持一致。再次手动签到可在同一天重新开始计时。

新路由默认认证，查询绑定当前用户；`@Self()` 只表示权限能力。富文本在服务端清洗，资源归属随信件事务校验，私有存储不能静态公开。完整编码边界见 [AGENTS.md](../AGENTS.md)，工具接口见 [MCP 开发说明](docs/mcp.md)。

## 数据库工具

应用配置 `synchronize: false`，普通启动和质量检查不执行迁移或种子操作。以下命令在 `backend/` 或根目录均可执行；写入前须明确目标数据库和操作授权。

| 命令                    | 行为                                   |
| ----------------------- | -------------------------------------- |
| `npm run db -- check`   | 检查连接、表和种子状态，不改数据库     |
| `npm run db -- init`    | 初始化数据库、执行迁移并写入种子       |
| `npm run db -- migrate` | 执行待运行迁移                         |
| `npm run db -- seed`    | 初始化内置角色，并创建或更新指定管理员 |
| `npm run db -- reset`   | **销毁并重建目标数据库**               |

CLI 与 API 共用根目录 `.env`；例如 `npm run db -- check`。CLI 当前要求 `PORT`、全部 `DB_*` 和 `INIT_ADMIN_*`，维护前需在文件中准备完整信息。`check` 不写数据库或环境文件，也不生成密钥；`--help` 不加载配置。

升级已有数据库前，先在旧版本导出并安全保存数据库配置，将运行设置（特别是 `JWT_SECRET`、VAPID 私钥、SMTP 和存储凭据）迁入根目录 `.env`，验证后再应用 `RemoveRuntimeConfiguration1750000000000`。该增量只删除旧 `runtime_configuration` 表，不触碰业务数据，不自动导出加密内容；回退只恢复空表，旧配置须从备份恢复。新安装执行迁移后的最终结构不包含配置表，不再需要 `CONFIG_MASTER_KEY`。旧本地 `backend/.env` 应移到根目录 `.env`。

Before upgrading, export saved settings with the old version and preserve the existing signing, push, SMTP and storage credentials in the root `.env` file. The removal migration drops only the obsolete configuration table. It does not export encrypted values, and rollback restores only an empty table. Normal startup never runs migrations.

迁移清单在 [src/database/migrations.ts](src/database/migrations.ts)。1.0.0 前默认合入初始基线；需要保留数据或从 1.0.0 起，使用评审后的增量迁移。当前资源表及信件资源字段在初始基线中，已运行旧基线的数据库仅执行现有增量无法补齐，需另行准备迁移；不要为通过检查而重置数据库。

创建空迁移可在 `backend/` 执行 `npm run typeorm -- migration:create src/database/migrations/DescribeChange`；生成或回退迁移会访问配置数据库，需要单独授权。

MCP/CLI 共用授权，公开 `GET /ai` 提供 Skill 清单、说明、CLI 和完整安装包；详见 [AI 接入](docs/mcp.md)。授权页面与个人业务工具的权限、附件上传、辅助签到及超时投递确认也在该文档。Skill/CLI 分发无需数据库变更；已有数据库尚未应用 MCP 权限表时，需要审阅 `McpPermissions1730000000000` 增量迁移；启动不自动迁移。

初始化失败会释放当前服务的写入状态，保留前端已填写的内容，并按数据库认证、权限、地址或超时等类别返回安全提示；不向浏览器返回驱动原始消息、SQL 或连接凭据。账号初始化兼容 MySQL 驱动返回的数字或字符串锁结果，仅在明确返回未取得锁时提示另一个实例正在初始化。
