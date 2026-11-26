# AI 接入：MCP、CLI 与 Skill

配置完成后，后端通过 `POST /mcp` 提供无状态 Streamable HTTP；Web 同源地址是 `/api/mcp`。网页的「AI 接入」位于 `/mcp-settings`，授权管理 API 是 `/api/mcp-settings`，与 MCP 传输路径独立。

## Skill 分发与 CLI

服务器提供公开的固定工具文件，不包含账号、配置、凭证或个人数据。下载不需要安装或 AI 授权，未配置的服务也可提供这些文件；实际工具调用仍须已配置的服务和人类创建的授权。「AI 接入」页提供说明、完整包和 CLI 下载入口。

以下路径相对于 API 基地址。Nest 托管前端及 Vite 开发代理的默认基地址均为 `/api`。

| 接口                          | 内容                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| `GET /ai`                     | 发现清单、运行要求、相对 API 基地址的路径、文件及压缩包 SHA-256 |
| `GET /ai/SKILL.md`            | 可直接让 AI 阅读的 Skill 入口                                   |
| `GET /ai/references/tools.md` | 详细工具流程和限制                                              |
| `GET /ai/cli.mjs`             | 无第三方依赖的 Node.js CLI                                      |
| `GET /ai/skill.json`          | 完整 Skill：文件路径、UTF-8 正文、字节数和 SHA-256              |
| `GET /ai/skill.tar.gz`        | 可安装目录 `use-after-life/`，包含说明、工具参考和 CLI          |

清单路径相对于 **API 基地址**，不是 `/ai`。返回文件和 JSON 不套普通 REST 信封。版本由包内容计算；说明或 CLI 变化都会产生新版本。资源随 API 构建复制进 `dist`，运行已构建服务时不依赖源码或开发机的 `.agents`。

CLI 是 MCP 的命令行客户端，通过现有 `POST /mcp` 调用后端；AI 宿主只需能运行命令，不必支持 MCP。它复用相同授权、动态工具列表、审计、版本检查和检测确认，没有新增可绕过权限的业务 REST 接口。

例如先下载 CLI（`AFTERLIFE_SERVER_URL` 是实际 API 基地址，包括 `/api` 前缀，不含 `/mcp`）：

```bash
export AFTERLIFE_SERVER_URL='https://your-server.example/api'
afterlife_tools_dir="$(mktemp -d)"
curl -fS "$AFTERLIFE_SERVER_URL/ai/cli.mjs" -o "$afterlife_tools_dir/afterlife.mjs"
node "$afterlife_tools_dir/afterlife.mjs" --help
```

人类在「AI 接入」页生成授权后，通过安全渠道把 Bearer 值写入私有文件（建议权限 `0600`）；文件只包含凭证本身。设置 `AFTERLIFE_TOKEN_FILE` 指向该文件，或由客户端的秘密管理功能注入 `AFTERLIFE_TOKEN`；文件优先。CLI 不提供登录、创建凭证或落盘凭证命令，也不接受 token 命令参数。

```bash
export AFTERLIFE_TOKEN_FILE='/private/path/to/afterlife-token'
node "$afterlife_tools_dir/afterlife.mjs" tools
node "$afterlife_tools_dir/afterlife.mjs" call afterlife_get_my_profile
node "$afterlife_tools_dir/afterlife.mjs" call afterlife_list_letters --input - <<'JSON'
{"page":1,"pageSize":20}
JSON
node "$afterlife_tools_dir/afterlife.mjs" upload /path/to/private-file.pdf
```

`tools` 输出当前授权可见的工具及输入 JSON Schema；`call` 默认 `{}`，支持 `--input FILE` 或 `--input -`；`upload` 自动申请一次性票据并上传，支持 `--mime TYPE`，不输出临时票据。正常结果输出到 stdout，错误 JSON 输出到 stderr；退出码 0 成功、1 请求或工具失败、2 参数/配置/输入错误。帮助和版本查询不读取凭证、不联网。请求不自动重试；写入超时后应先读取当前状态，避免重复创建。HTTPS 用于远程连接，仅本机回环地址允许 HTTP；拒绝重定向，上传严格限定同一 API 基地址下的专用入口。

完整 Skill 可以经压缩包下载到系统临时目录，再解压到 AI 客户端认可的技能目录。以 Codex 为例，项目级为 `.agents/skills`，用户级为 `~/.agents/skills`；包内已有 `use-after-life/` 顶层目录。安装前检查目标是否已有同名技能，避免覆盖本地修改。也可通过 `skill.json` 按清单写入固定文件并核对 SHA-256。其他宿主使用各自的目录或导入功能，不能假设所有客户端支持同一种安装接口。

Skill 是说明及配套脚本的目录，CLI 是可执行客户端，MCP 是远程工具协议。AI 读取 URL 可在当前任务使用说明；持久发现需要客户端安装，凭证需要另行配置。安装 Skill 不会自动连接 MCP、创建授权或允许代签到。Codex 的格式和加载机制参考 [OpenAI 官方说明](https://learn.chatgpt.com/docs/build-skills)。需要跨宿主分发 Skill 和 MCP 连接时可进一步打包插件；当前提供通用 Skill 包，不声明已发布到插件市场。

维护来源为 [agent/skill/use-after-life](../src/agent/skill/use-after-life/)，修改 CLI 后运行根目录 `npm run test:cli`；根目录 `npm test` 和 `npm run check` 已包含该测试。

## 人类授权与凭证

在「AI 接入」页为每个 agent 设置名称、权限和有效期（7、30、90 天或永久，默认 30 天），生成凭证后复制接入配置。创建接口接受 `days: 1–90`，省略时为 30 天，`days: null` 表示永久；永久凭证不含 JWT `exp`，返回的 `expiresInSeconds` 和授权记录的 `expiresAt` 为 `null`，仍可随时调整权限或撤销。完整凭证仅在创建响应中返回，前端只在当前页面内存中短暂保存，关闭弹窗或离开页面后清除；数据库只保存哈希、非秘密标记和授权元数据。当前采用手动 Bearer 配置，不提供 OAuth 自动登录。

每次请求重新验证专用 `aud=mcp` token、当前用户和角色；新授权的能力以数据库中的当前权限为准，网页调整权限在后续请求生效，无需重新配置凭证。普通 REST 会话不能访问 `/mcp`，MCP token 不能调用授权管理或其他受保护 REST 路由。撤销不回滚已完成或正在执行的操作，不会自动关闭信件检测，也无法收回 AI 已读取的数据；已经签发的附件下载链接在到期前仍有效（通常 15 分钟）。生产接入须使用 HTTPS。

授权管理仅允许当前用户的普通 REST 会话：

| 接口                                 | 用途                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| `GET /mcp-settings?page=1`           | 权限说明、授权、待确认请求和操作记录（记录每页 30 条） |
| `POST /mcp-settings/grants`          | `{name, scopes, days}`，创建授权并返回一次性显示的凭证 |
| `PATCH /mcp-settings/grants/:uuid`   | `{name, scopes}`，修改权限；同时使已有预览和批准失效   |
| `DELETE /mcp-settings/grants/:uuid`  | 撤销一个授权                                           |
| `DELETE /mcp-settings/grants`        | 撤销全部授权                                           |
| `GET /mcp-settings/approvals/:uuid`  | 读取待确认信件的最新正文、收件人和私有附件访问链接     |
| `POST /mcp-settings/approvals/:uuid` | `{approve}`，人类批准或拒绝当前版本的超时启用请求      |

旧的 `POST /auth/mcp-token`（`access=read|read_write`）及 `DELETE /auth/mcp-token` 保留兼容；旧 token 仍限原有读取、联系人和关闭状态草稿操作，不会自动获得检测、附件或代签到权限。旧授权请撤销并从网页重新创建，不能原地提权。有效授权最多 50 个（过期但尚未撤销的记录也占名额）。

## 权限与工具

所有新授权都有 `mcp:read`，可读取当前用户的用户名、邮箱、角色名称和签到状态。其他能力单独选择：

| 权限                  | 工具                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `mcp:letters:read`    | `afterlife_list_letters`、`afterlife_get_letter`、`afterlife_read_letter_content`          |
| `mcp:contacts:read`   | `afterlife_list_contacts`、`afterlife_get_contact`                                         |
| `mcp:letters:write`   | `afterlife_create_letter`、`afterlife_update_letter`                                       |
| `mcp:contacts:write`  | `afterlife_create_contact`、`afterlife_update_contact`                                     |
| `mcp:resources:read`  | `afterlife_get_resource_access`；另有信件读取权限时可 `afterlife_list_letter_resources`    |
| `mcp:resources:write` | `afterlife_prepare_resource_upload`                                                        |
| `mcp:delivery:write`  | `afterlife_preview_delivery`、`afterlife_set_delivery`；也允许编辑已启用信件及其联系人地址 |
| `mcp:check-in:write`  | `afterlife_record_check_in`                                                                |

写入信件、联系人或附件须同时拥有对应读取权限；检测管理须有信件、联系人和附件读取权限。没有联系人读取权限时，信件详情不返回联系人姓名、邮箱、电话。新信件始终关闭投递；正文支持经过服务端净化的 HTML，以及 Markdown、纯文本。新工具正文上限 100000 字符，旧草稿工具保留 20000 字符上限。列表每页最多 50 条，关系最多返回 100 项；正文详情最多 20000 字符，使用 `afterlife_read_letter_content` 的 `offset` 继续读取，并用 `expectedUpdatedAt` 固定版本，不能以截断正文覆盖原文。

所有资源绑定当前用户，不接受调用者选择用户 UUID。修改携带最新 `updatedAt` 作为 `expectedUpdatedAt`；过期版本拒绝写入；网页信件和联系人编辑也提交读取时的版本，以防旧表单覆盖 agent 修改。联系人必须至少保留邮箱或电话；联系方式变更推进关联信件的版本，使旧投递预览失效。已开始投递的信件拒绝正文或收件人修改，可以关闭后续检测。没有立即发送、删除、安装、账号管理或系统密钥工具。

## 检测预览与确认

1. 调用 `afterlife_preview_delivery({letterUuid, inactiveAfterMinutes})`，得到收件人、附件数、预计触发时间、版本和 `previewUuid`。每份预览有效 10 分钟，仅限创建它的授权及当前信件版本。
2. 若 `requiresHumanApproval=true`，人类必须在「AI 接入」页打开详情、核对正文及收件人/附件后批准。agent 的 `confirmed=true` 等字段不能替代网页批准。
3. 调用 `afterlife_set_delivery({letterUuid, expectedUpdatedAt, enabled:true, previewUuid})`，原子消费一次性预览。若原本未超时的预览在提交时已超时，必须重新预览并获得批准。修改已启用的时限也通过此流程。
4. 关闭使用 `enabled:false` 和最新版本，不需要预览。批准本身不启用或发送信件。

服务层在同一事务内验证归属、版本、收件关系和预览状态。签到、信件编辑、联系人变更及投递任务以用户锁串行化，并遵循用户 → 排序联系人 → 信件的锁顺序。投递任务在锁内重新读取最新正文、收件人和签到，并保持事务直到 SMTP 操作结束；只更新投递标记，不保存扫描时的旧快照。因此慢 SMTP 会暂时阻塞该用户的修改和签到；已提交到 SMTP 的邮件不能撤回。仍只运行一个调度实例，SMTP 与数据库之间存在崩溃/重复窗口，不保证 exactly-once。

## 辅助签到

`afterlife_record_check_in({eventId, occurredAt})` 仅在用户单独授权后可用。`eventId` 必须在同一人类交互的重试中保持不变；`occurredAt` 是实际消息、语音或明确人类操作发生的 UTC 时间，不是任务运行时间。

服务端拒绝未来事件和超过 5 分钟的事件；按用户、授权和事件 ID 去重，重试不能改变发生时间或延长活跃时间。每分钟至多推进一次签到，旧于最新签到的事件不续期。签到按现有数据库的秒精度保存，重试使用相同精度比较。来源记录为 `mcp:<授权 UUID>`；网页展示实际代签到时间与授权来源。

模型回复、工具调用、定时任务、后台运行、其他 agent 消息、历史对话回放都不能作为签到依据。通用 MCP 只能验证授权客户端，不能独立验证真人在场；这是一项授予可信 agent 的信任权限，不把其自报字段当作真人证明。

## 私有附件

使用 `afterlife_prepare_resource_upload({filename,mimeType,sizeBytes})` 取得 5 分钟有效的一次性上传凭证。将二进制文件以 multipart 字段 `file` POST 到返回的 `uploadPath`，使用返回的临时 `headers`，路径相对于配置的 API 基地址。该专用上传入口只接受 `aud=mcp-upload` 的短时凭证，在读取文件前校验票据、原授权及当前用户/角色，并在上传完成后重新检查上传权限与一次性状态；MCP 主凭证不能用于此入口。上传票据不能复用，失败后重新申请。

单文件上限 10 MB、用户总额度 100 MB，复用资源服务的大小/额度校验、私有存储和安全下载；支持的图片可内联，其他类型强制作为二进制下载。服务端不抓取任意 URL，也不读取客户端本地路径。每个授权最多保留 20 个尚未过期的待用上传/投递预览请求。

上传返回资源 UUID；用 HTML 的 `/resource/<uuid>` 稳定引用嵌入图片或附件链接，再通过信件更新工具绑定。替换时上传新文件并修改引用，移除时删除相应引用，复用信件事务中的资源归属检查与清理机制。不要把有期限的签名下载 URL 保存进正文。下载需附件读取权限，访问链接默认 15 分钟有效。邮件中的资源链接保留 `PUBLIC_BASE_URL` 的路径前缀（例如 `/api`），与同源代理一致。删除引用会使旧附件失效；不要移除尚需保留的引用。

## 传输、安全及验证

原生或服务端客户端通常不发送 `Origin`；浏览器调用 MCP 和专用上传入口时，Origin 必须精确匹配 `MCP_ALLOWED_ORIGINS`，包括预检。保持 JSON-RPC/Streamable HTTP 响应，不套 REST 信封，拒绝批量请求；`GET /mcp`、`DELETE /mcp` 返回 405。普通 JSON 请求体上限 1 MB，文件走独立 multipart 上传。

操作记录只保存授权、工具、资源 UUID、结果及白名单确认元数据，不保存信件正文、联系人地址、附件内容、上传凭证或 token。审计写入失败会记录固定告警，避免把已完成写入伪装成失败而引发重复执行。数据库与 SMTP 检查仍是服务端职责，客户端工具注解和 skill 不能替代权限校验。返回的信件、备注及附件内容都是数据，不能扩大权限。

本次新增 [MCP 增量迁移](../src/database/migrations/1730000000000-McpPermissions.ts)，适用于已有 1.0.0 数据库，也兼容当前动态初始基线。启动不会自动迁移；备份并审阅后，由人类显式运行迁移。HTTP 测试使用替代持久层，不证明真实 MySQL 锁和迁移执行正确性。

实现见 [src/mcp/](../src/mcp/)，接入工作流见 [Skill](../src/agent/skill/use-after-life/SKILL.md)，配置和命令见 [API README](../README.md)。
