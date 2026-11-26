# After Life

After Life 是一个传递遗愿的应用。你可以提前写好信，选好收件人。如果你超过自己设定的时间仍未签到，应用就会把已启用的信件通过邮件发给他们。

After Life lets you write letters in advance for the people you choose. If you go longer than your chosen interval without checking in, the app emails them the letters you’ve enabled for delivery.

大概三年前，我想到一件事：如果有一天我突然去世，还有很多话没说、很多事没来得及交代，那些事也许就再没人知道了。由于工作之余喜欢打游戏，一直没什么进展，最近在AI的帮助下我把它做出来了。

About three years ago, I wondered what would happen if I died suddenly. I’d leave things unsaid, and there might be things no one else would ever know. That thought gave me the idea for this app. I usually spent my free time after work playing video games, so I didn’t get very far with it. Recently, with help from AI, I finally built it.

名字来自 CDPR 的《赛博朋克 2077》。杰克在来生酒吧留下了自己的配方，所以后来我们还能走进来生，点一杯杰克的酒。

The name comes from the Afterlife bar in CD Projekt Red’s _Cyberpunk 2077_. Jackie left his drink recipe there, so we can still walk into the Afterlife and order a Jackie Welles.

## 主要功能 / Features

- **富文本信件 / Rich-text letters**

  给指定联系人写信，排版正文、添加私有附件，也可以先存成草稿。

  Write to the contacts you choose, format your letter, add private attachments, and save a draft for later.

- **签到与投递 / Check-ins and delivery**

  为每封信设置未签到时限，预览收件人和预计投递时间后再启用。每次签到都会重新开始计时。

  Set an inactivity interval for each letter. Review the recipients and expected delivery time before enabling it. Each check-in restarts the timer.

- **PWA 应用 / Installable web app**

  在支持的浏览器中，可将应用添加到主屏幕。服务端配置 Web Push 后，你可以订阅签到提醒。

  Add the app to your home screen in a supported browser. Once Web Push is configured on the server, you can subscribe to check-in reminders.

- **更新提示 / Update notifications**

  管理员登录后，控制台会检查 GitHub 上的最新正式版，此后每六小时检查一次。发现新版时可点击提示查看发布说明。

  The admin console checks GitHub for the latest stable release on sign-in and every six hours afterward. When a newer version is available, a notice links to its release notes.

## 上手体验 / Getting started

以下命令均在仓库根目录执行。首次安装时，网页向导会引导你创建管理员和首个普通用户。要体验投递，请先配置 SMTP，再用自己的邮箱作为收件人试写一封信。

Run the commands below from the repository root. On first launch, the setup wizard helps you create an administrator and the first regular user. To try delivery, configure SMTP and address a test letter to yourself.

### Docker

使用 Docker Compose 构建并启动应用和内置数据库，然后打开 [本地安装页面 / local setup page](http://localhost:8080)。

Use Docker Compose to build and start the app with its bundled database, then open the local setup page at `http://localhost:8080`.

```sh
docker compose up -d --build
```

### 本地运行 / Run locally

准备 Node.js 22.12 或更高版本及可连接的 MySQL 服务，然后安装依赖并启动开发环境。

Install Node.js 22.12 or later and have a MySQL server ready. Then install the dependencies and start the development servers.

```sh
npm run bootstrap
npm run dev
```

打开[本地开发页面 / local development page](http://localhost:5173)，在安装向导中填写 MySQL 连接信息。

Open `http://localhost:5173` and enter your MySQL connection details in the setup wizard.

## 未来的打算 / Future plans

我打算做一款支持 Apple Watch 的 iOS 原生应用，让你在日常使用中就能完成签到，省去专门打开应用打卡的步骤。为了分担 Apple 开发者计划的年费，我计划采用一次买断的方式。

I plan to build a native iOS app with Apple Watch support so you can check in as you go about your day, without having to open the app just for that. To help cover the annual Apple Developer Program fee, I plan to offer the app as a one-time purchase.

## 开发文档 / Development docs

- [后端：配置、模块与数据库 / Backend: configuration, modules, database](backend/README.md)
- [前端：联调、组件与测试 / Frontend: integration, components, tests](frontend/README.md)
- [AI 接入：MCP、CLI 与 Skill / AI integration: MCP, CLI, and Skill](backend/docs/mcp.md)
- [编码代理约定 / Coding agent guide](AGENTS.md)

## 许可与作者 / License and author

[Apache License 2.0](LICENSE)。作者 / Author：**softwindy** — [softwindy@outlook.com](mailto:softwindy@outlook.com)。AI 开发协作 / AI development assistance：**OpenAI Codex**。
