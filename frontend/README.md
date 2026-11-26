# After Life Web 开发

React + Vite 客户端。源码、依赖和构建产物位于 `frontend/`，环境文件统一位于项目根目录；统一启动入口见[根目录 README](../README.md)。

## 命令与联调

使用 Node.js 22.12+，以下命令在 `frontend/` 执行：

| 命令                                    | 用途                                              |
| --------------------------------------- | ------------------------------------------------- |
| `npm install` / `npm run dev`           | 安装依赖 / 启动开发服务，端口 5173                |
| `npm run build`                         | pro 模式检查并构建到 `dist/`                      |
| `npm start` / `npm run preview`         | 通过 Nest 预览两端构建产物，默认端口 3000         |
| `npm run lint` / `npm run format:check` | 代码与格式检查                                    |
| `npm test`                              | 组件契约、布局、启动状态、API 代理及 SPA 回退回归 |
| `npm run test:ui`                       | Chromium 浏览器回归，启动本地 Vite 并模拟 API     |
| `npm run icons`                         | 重新生成 PWA 图标                                 |

浏览器默认访问同源 `/api`，开发时 Vite 将 `/api/user` 去掉前缀后代理为后端 `/user`。开发、预览和构建从根目录 `.env` 读取前端设置，字段见[双语示例](../.env.example)。

| 配置                    | 用途                                                   |
| ----------------------- | ------------------------------------------------------ |
| `VITE_API_PROXY_TARGET` | 开发代理目标，默认 `http://localhost:3000`             |
| `VITE_API_BASE_URL`     | 构建时覆盖 API 基础地址，默认 `/api`，修改后需重新构建 |

例如在根目录 `.env` 中设置 `VITE_API_PROXY_TARGET=http://localhost:3001`，再启动开发服务。`VITE_*` 会进入客户端环境，不得放入秘密。修改 API 基础地址后需重新构建前端。

在根目录执行 `npm run build` 后，`npm start` 和 `npm run start:pro` 都由 Nest 在同一端口提供页面和 `/api`，支持直接刷新前端路由。含本地资源的邮件应将后端 `PUBLIC_BASE_URL` 设置为 `https://example.com/api`，与资源代理入口一致；后端配置见 [API README](../backend/README.md)。

Docker 镜像使用相同的 Nest 托管方式，入口默认 `http://localhost:8080`，部署见 [Docker 部署](../backend/README.md#docker-部署)。向导使用后端返回的数据库默认值；已配置的数据库密码只显示留空复用提示，修改连接信息后需重新填写密码。

## 代码结构

| 入口                                                                                       | 责任                                                |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| [src/App.tsx](src/App.tsx)                                                                 | 会话启动、个人数据与页面装配                        |
| [src/hooks/](src/hooks/)                                                                   | 安装、启动动画、通知、设置及操作反馈                |
| [src/components/routing/](src/components/routing/)                                         | 路由守卫与页面参数组合                              |
| [src/pages/](src/pages/)                                                                   | 页面交互与表单草稿，通过 typed props 使用数据和操作 |
| [src/lib/api.ts](src/lib/api.ts)、[src/lib/api-types.ts](src/lib/api-types.ts)             | HTTP、认证头、响应解析与接口类型                    |
| [src/components/layout/](src/components/layout/)、[src/components/ui/](src/components/ui/) | 公共外壳与基础组件                                  |
| [src/components/letters/RichTextEditor.tsx](src/components/letters/RichTextEditor.tsx)     | 信件编辑和私有资源上传                              |
| [src/sw.ts](src/sw.ts)、[src/lib/push.ts](src/lib/push.ts)                                 | 通知 Service Worker 与推送订阅                      |

页面不直接调用 `fetch`。Effect 和异步回调要在卸载或会话切换后丢弃过期响应，遵循 `react-hooks/exhaustive-deps`，不要通过忽略规则维持旧闭包。TS/TSX 使用双引号，按根目录 Prettier 配置格式化。

登录页支持自助注册日常账户。管理员可在 `/admin` 查看平台总览，在 `/users` 创建和编辑账号，并在 `/roles` 调整角色权限。

「AI 接入」页面位于 `/mcp-settings`，展示逐项权限和风险，管理独立授权、短暂显示的接入凭证、超时投递的人工确认和操作记录。页面通过 `hooks/useMcpSettings.ts` 调用 transport；离开页面或切换会话丢弃过期响应并清除未保存的凭证。后端能力、权限依赖及迁移见 [MCP 接入](../backend/docs/mcp.md)。

「系统设置」的对象存储面板通过 `hooks/useStorageSettings.ts` 管理 S3/MinIO 和阿里云 OSS 配置、连接测试与本地文件分批迁移。凭据不回显，留空保留；先保存配置，再迁移已有文件。迁移保留本地原件，页面显示进度，离开页面后不再发起下一批，当前批可能继续完成，重新进入后可刷新并继续。使用前需应用后端对象存储增量迁移；权限和配置说明见 [API README](../backend/README.md#外部对象存储与迁移)。

## 信件写作与恢复

`pages/LettersScreen.tsx` 管理信件索引和恢复入口，`hooks/useLetterComposer.ts` 管理编辑会话，`components/letters/LetterComposerDialog.tsx` 组合编辑、正文预览与投递核对。正文转换和资源链接处理统一在 `lib/letter-content.ts`，信件样式位于 `styles/letters.css`。

- 每位所有者在当前浏览器保留一份恢复草稿，修改后立即写入本地存储，保留 7 天；正式保存、明确丢弃或退出登录后清除。内容以明文保存在此浏览器，不在设备之间同步；登录过期后重新认证同一所有者仍可恢复。标签页之间同步会话变更，其他标签页退出后会关闭旧编辑会话，旧响应不能重新写回或清除新草稿。关闭有改动的编辑器时可选择继续、保留草稿或放弃；浏览器禁止存储时明确提示，不能承诺已保护草稿。
- 草稿不自动更新服务端信件、收件人、签到或投递规则，也不保存投递确认令牌及私有资源的短期签名链接。未正式保存的上传附件仍遵循服务端 24 小时清理规则。原信件版本变化时可以作为新信恢复，自动投递关闭，私有附件需重新上传。
- `LetterPreview` 在信件阅读、编辑器预览和 AI 人工核对中复用。HTML 使用标签和网址白名单；私有图片与附件通过当前所有者认证重新获取访问链接，同一资源的重复引用合并请求。单个附件不可用时保留正文，并提供刷新链接操作。邮件客户端的实际显示仍可能存在差异。
- 启用自动投递或保存已启用的信件时，先请求服务端投递摘要，再明确确认；摘要展示计时依据、预计触发时间、有效收件人、跳过的联系人、私有附件数量与投递后保留期。已经超时的情况需额外勾选确认。服务端在保存事务中再次核对版本、签到、内容与收件人，变化或过期后必须重新预览。

Recovery drafts stay in this browser for seven days and are cleared on save, discard or logout. They do not change live delivery content or liveness. Full previews renew owner-authorized resource links; enabling delivery requires a current server review and explicit confirmation.

## UI 开发

公共组件从 `src/components/ui/index.ts` 导入，根入口只导入一次 `components/ui/styles.css`；登录后的 `/ui-kit` 可查看实际组件状态。

- 复用 `src/styles/tokens.css` 的语义令牌；组件、选择器、布局和动画样式分别位于 `components.css`、`select.css`、`layouts.css`、`motion.css` 等文件。
- 基础组件不调用业务 API。表单使用 `Field` 关联标签、帮助和错误；图标按钮提供可访问名称，提交按钮显式设置 `type="submit"`。
- 单选下拉统一使用 `Select`，多选使用 `MultiSelect`，复选框使用 `Input type="checkbox"`，复用设计令牌；不要在页面中使用原生 `<select>` 或未带公共样式的表单控件。
- 使用已有 `Dialog` / `ConfirmDialog` 保持模态隔离与焦点恢复；弹窗内的 Radix 浮层挂载到当前 dialog，保留 `OverlayContainerContext`。
- 保持键盘操作、可见焦点、长文本换行和窄屏布局；表格在自身容器横向滚动，动画遵循 `prefers-reduced-motion`。
- 修改公共组件或令牌后，运行 lint、格式检查、组件测试、浏览器测试和构建，并在 `/ui-kit` 检查交互状态。

启动动画由 `useStartupSequence` 控制，播放记录保存在 `after-life-startup` Cookie；后端状态仍以接口为准。调试参数：`?startup=play` 强制播放，`skip` 跳过，`reset` 清除记录后重播，`hold` 停在结束画面供预览。登录与安装背景支持暂停，输入时自动暂停。

PWA worker 仅处理通知，不拦截 fetch 或提供离线缓存，激活时清除旧 Cache Storage。推送在生产环境需 HTTPS，localhost 可用于开发。

## 浏览器测试

首次在 `frontend/` 执行 `npx playwright install chromium`，或用 `BROWSER_EXECUTABLE_PATH` 指定本机 Chrome，再运行 `npm run test:ui`。测试模拟 API，不启动后端或访问数据库；`UI_TEST_PORT` 可覆盖默认端口 5192。

截图默认输出到系统临时目录，可通过 `UI_SCREENSHOT_DIR` 指向其他临时目录或 `.codex`。根目录 `npm run check` 不包含浏览器 UI 测试，也不安装浏览器；Safari、iOS 和实际推送仍需设备验证。

CI 另外安装 Chromium 并执行浏览器测试，覆盖草稿恢复、存储失败、富文本安全、私有附件、投递核对、320/390/768px 编辑器，以及缩短视口时的保存操作。缩短视口用于模拟软键盘占用空间，不能替代真实 iOS/Android 输入法验收。
