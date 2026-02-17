# openclaw-kook

[English](#english) | [中文](#中文)

---

## English

**OpenClaw KOOK Plugin** — Connect your AI assistant to [KOOK (开黑啦)](https://www.kookapp.cn/) servers and DMs.

### Features

- 🤖 **AI in KOOK** — Your OpenClaw AI assistant responds in KOOK channels and DMs
- 💬 **KMarkdown** — Full KMarkdown rendering (bold, italic, code, links, etc.)
- 🖼️ **Media** — Send and receive images, videos, audio, and files
- 😄 **Reactions** — Add/remove emoji reactions on messages
- 📇 **Card Messages** — Rich card message support
- 🔒 **Access Control** — DM allowlists, group allowlists, mention-gating
- ⚡ **Block Streaming** — Edit-mode streaming for real-time response display
- 💭 **Typing Indicator** — Emoji-based typing indicator (💭 reaction)
- 📊 **Quota Tracking** — Daily message quota monitoring (10,000/day limit)
- 🔄 **Auto Reconnect** — Resilient WebSocket with heartbeat, resume, and backoff
- 📜 **Chat History** — Group chat history context for better AI responses

### Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and running (`openclaw >= 2026.2.0`)
- A KOOK bot token ([create one here](https://developer.kookapp.cn/app/index))

### Quick Start

#### Step 1: Create a KOOK Bot

1. Go to [KOOK Developer Portal](https://developer.kookapp.cn/app/index)
2. Click **"Create Application"** (新建应用)
3. Enter an app name → click **Create**
4. In the left sidebar, click **"Bot"** (机器人)
5. Click **"Enable Bot"** (创建机器人) if not already enabled
6. Copy the **Token** — you'll need it in the next step

#### Step 2: Invite the Bot to Your Server

1. Still in the Developer Portal, go to **"Invite Link"** (邀请链接)
2. Select the permissions your bot needs (at minimum: **View Messages**, **Send Messages**)
3. Open the invite link in your browser
4. Select your KOOK server and confirm

#### Step 3: Install the Plugin

**Option A — Install from npm (recommended):**

```bash
openclaw install openclaw-kook
```

**Option B — Install from source:**

```bash
# Clone the repo
git clone https://github.com/PPPPanda/openclaw-kook.git

# Go to OpenClaw extensions directory
cd ~/.openclaw/extensions/

# Symlink or copy the plugin
ln -s /path/to/openclaw-kook kook

# Install dependencies
cd kook && npm install
```

#### Step 4: Configure

Add to your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "channels": {
    "kook": {
      "enabled": true,
      "token": "YOUR_KOOK_BOT_TOKEN"
    }
  }
}
```

Or run the interactive setup:

```bash
openclaw setup
```

#### Step 5: Restart and Test

```bash
openclaw gateway restart
```

Now send a DM to your bot on KOOK, or @mention it in a server channel! 🎉

### Configuration Reference

All options go under `channels.kook` in your OpenClaw config:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the KOOK channel |
| `token` | string | — | **Required.** KOOK bot token |
| `connectionMode` | `"websocket"` \| `"webhook"` | `"websocket"` | Connection mode (webhook not yet implemented) |
| `dmPolicy` | `"open"` \| `"pairing"` \| `"allowlist"` | `"pairing"` | Who can DM the bot |
| `allowFrom` | string[] | `[]` | User IDs allowed to DM (for `allowlist` / `pairing` mode) |
| `groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | `"allowlist"` | Who can trigger the bot in groups |
| `groupAllowFrom` | string[] | `[]` | User IDs allowed in group channels |
| `requireMention` | boolean | `true` | In groups, require @mention to respond |
| `historyLimit` | number | `10` | Number of recent group messages to include as context |
| `dmHistoryLimit` | number | `0` | Number of recent DM messages to include as context |
| `textChunkLimit` | number | `5000` | Max characters per message chunk |
| `blockStreaming` | boolean | `true` | Enable edit-mode streaming (progressive display) |
| `blockStreamingMode` | `"edit"` \| `"append"` | `"edit"` | Streaming mode: edit existing message or append new ones |
| `mediaMaxMb` | number | `30` | Max media download size in MB |
| `renderMode` | `"auto"` \| `"kmarkdown"` \| `"card"` | `"auto"` | Output rendering mode |
| `quotaWarningThreshold` | number | `0.8` | Warn when daily quota usage exceeds this ratio (0-1) |

### Advanced: Per-Group Settings

You can configure settings per KOOK server/guild:

```json
{
  "channels": {
    "kook": {
      "token": "...",
      "groups": {
        "GUILD_ID": {
          "requireMention": false,
          "allowFrom": ["USER_ID_1", "USER_ID_2"],
          "enabled": true,
          "systemPrompt": "You are a helpful assistant in this server."
        }
      }
    }
  }
}
```

### Advanced: Per-DM Settings

```json
{
  "channels": {
    "kook": {
      "token": "...",
      "dms": {
        "USER_ID": {
          "enabled": true,
          "systemPrompt": "Custom prompt for this user."
        }
      }
    }
  }
}
```

### Message Actions (Agent Tool)

The plugin registers a `message` tool that the AI can use. Supported actions:

| Action | Description |
|--------|-------------|
| `send` | Send a message (text, media, or card) |
| `react` | Add/remove emoji reaction |
| `read` | Read message history from a channel |
| `edit` | Edit an existing message |
| `delete` | Delete a message |
| `channel-info` | Get channel details |
| `channel-list` | List channels in a guild |
| `member-info` | Get user info |

### How It Works

```
KOOK Server ←→ WebSocket ←→ Plugin ←→ OpenClaw Agent ←→ AI Model
```

1. The plugin connects to KOOK via WebSocket (with auto-reconnect and heartbeat)
2. Incoming messages are parsed and access-controlled
3. Allowed messages are dispatched to the OpenClaw agent
4. AI responses are converted to KMarkdown and sent back to KOOK
5. Block streaming shows responses progressively via message editing

### Troubleshooting

**Bot doesn't respond:**
- Check `openclaw status` — is the KOOK channel running?
- Verify the token is correct
- For DMs: make sure your user ID is in `allowFrom` (or set `dmPolicy: "open"`)
- For groups: make sure you @mentioned the bot (or set `requireMention: false`)
- For groups: check `groupAllowFrom` includes your user ID

**How to find your KOOK User ID:**
- Open KOOK → Click your avatar → Your numeric ID is shown in the profile

**Rate limiting (HTTP 429):**
- KOOK has a daily limit of 10,000 messages. The plugin tracks usage automatically.
- If you hit the limit, wait until 12:00 Beijing Time (UTC+8) for reset.

---

## 中文

**OpenClaw KOOK 插件** — 让你的 AI 助手接入 [KOOK（开黑啦）](https://www.kookapp.cn/) 服务器和私聊。

### 功能特性

- 🤖 **AI 接入 KOOK** — OpenClaw AI 助手在 KOOK 频道和私聊中自动回复
- 💬 **KMarkdown 渲染** — 完整支持 KMarkdown（加粗、斜体、代码、链接等）
- 🖼️ **媒体收发** — 支持图片、视频、音频、文件的发送和接收
- 😄 **表情回应** — 在消息上添加/移除 emoji 表情
- 📇 **卡片消息** — 支持富文本卡片消息
- 🔒 **访问控制** — 私聊白名单、群组白名单、@提及门控
- ⚡ **渐进式输出** — 通过消息编辑实时显示 AI 回复
- 💭 **思考指示器** — 使用 💭 表情作为"正在输入"指示
- 📊 **配额监控** — 每日消息配额跟踪（10,000条/天限制）
- 🔄 **自动重连** — 带心跳、恢复和退避的弹性 WebSocket 连接
- 📜 **聊天历史** — 群聊历史上下文，让 AI 回复更准确

### 前置要求

- 已安装并运行 [OpenClaw](https://github.com/openclaw/openclaw)（`openclaw >= 2026.2.0`）
- 一个 KOOK 机器人 Token（[在这里创建](https://developer.kookapp.cn/app/index)）

### 快速开始

#### 第一步：创建 KOOK 机器人

1. 打开 [KOOK 开发者中心](https://developer.kookapp.cn/app/index)
2. 点击 **"新建应用"**
3. 填写应用名称 → 点击 **创建**
4. 在左侧菜单点击 **"机器人"**
5. 如果尚未启用，点击 **"创建机器人"**
6. 复制 **Token** — 下一步需要用到

#### 第二步：邀请机器人到你的服务器

1. 还是在开发者中心，进入 **"邀请链接"**
2. 选择机器人需要的权限（至少需要：**查看消息**、**发送消息**）
3. 在浏览器中打开邀请链接
4. 选择你的 KOOK 服务器并确认

#### 第三步：安装插件

**方式 A — 从 npm 安装（推荐）：**

```bash
openclaw install openclaw-kook
```

**方式 B — 从源码安装：**

```bash
# 克隆仓库
git clone https://github.com/PPPPanda/openclaw-kook.git

# 进入 OpenClaw 扩展目录
cd ~/.openclaw/extensions/

# 创建符号链接或复制插件
ln -s /path/to/openclaw-kook kook

# 安装依赖
cd kook && npm install
```

#### 第四步：配置

在 OpenClaw 配置文件（`~/.openclaw/openclaw.json`）中添加：

```json
{
  "channels": {
    "kook": {
      "enabled": true,
      "token": "你的KOOK机器人Token"
    }
  }
}
```

或者运行交互式配置：

```bash
openclaw setup
```

#### 第五步：重启并测试

```bash
openclaw gateway restart
```

现在在 KOOK 上给机器人发私聊，或在频道中 @它！ 🎉

### 配置参考

所有配置项都放在 OpenClaw 配置的 `channels.kook` 下：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | `true` | 启用/禁用 KOOK 频道 |
| `token` | string | — | **必填。** KOOK 机器人 Token |
| `connectionMode` | `"websocket"` \| `"webhook"` | `"websocket"` | 连接模式（webhook 暂未实现） |
| `dmPolicy` | `"open"` \| `"pairing"` \| `"allowlist"` | `"pairing"` | 谁可以给机器人发私聊 |
| `allowFrom` | string[] | `[]` | 允许私聊的用户 ID 列表 |
| `groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | `"allowlist"` | 谁可以在群组中触发机器人 |
| `groupAllowFrom` | string[] | `[]` | 群组中允许触发的用户 ID 列表 |
| `requireMention` | boolean | `true` | 群组中是否需要 @提及才响应 |
| `historyLimit` | number | `10` | 群组上下文中包含的最近消息数 |
| `dmHistoryLimit` | number | `0` | 私聊上下文中包含的最近消息数 |
| `textChunkLimit` | number | `5000` | 每条消息的最大字符数 |
| `blockStreaming` | boolean | `true` | 启用渐进式输出（实时编辑消息） |
| `blockStreamingMode` | `"edit"` \| `"append"` | `"edit"` | 输出模式：编辑现有消息或追加新消息 |
| `mediaMaxMb` | number | `30` | 最大媒体下载大小（MB） |
| `renderMode` | `"auto"` \| `"kmarkdown"` \| `"card"` | `"auto"` | 输出渲染模式 |
| `quotaWarningThreshold` | number | `0.8` | 当日配额使用超过此比例时警告（0-1） |

### 进阶：按服务器配置

你可以为每个 KOOK 服务器单独设置：

```json
{
  "channels": {
    "kook": {
      "token": "...",
      "groups": {
        "服务器ID": {
          "requireMention": false,
          "allowFrom": ["用户ID_1", "用户ID_2"],
          "enabled": true,
          "systemPrompt": "你是这个服务器里的助手。"
        }
      }
    }
  }
}
```

### 进阶：按用户私聊配置

```json
{
  "channels": {
    "kook": {
      "token": "...",
      "dms": {
        "用户ID": {
          "enabled": true,
          "systemPrompt": "为这个用户定制的提示词。"
        }
      }
    }
  }
}
```

### 消息操作（AI 工具）

插件为 AI 注册了 `message` 工具，支持以下操作：

| 操作 | 说明 |
|------|------|
| `send` | 发送消息（文字、媒体或卡片） |
| `react` | 添加/移除表情回应 |
| `read` | 读取频道消息历史 |
| `edit` | 编辑已有消息 |
| `delete` | 删除消息 |
| `channel-info` | 获取频道信息 |
| `channel-list` | 列出服务器频道 |
| `member-info` | 获取用户信息 |

### 工作原理

```
KOOK 服务器 ←→ WebSocket ←→ 插件 ←→ OpenClaw Agent ←→ AI 模型
```

1. 插件通过 WebSocket 连接 KOOK（自动重连 + 心跳保活）
2. 接收到的消息经过解析和权限校验
3. 通过校验的消息分发给 OpenClaw Agent
4. AI 回复转换为 KMarkdown 发送回 KOOK
5. 渐进式输出通过消息编辑实时显示回复过程

### 常见问题

**机器人不回复：**
- 运行 `openclaw status` 检查 KOOK 频道是否在运行
- 确认 Token 是否正确
- 私聊：确保你的用户 ID 在 `allowFrom` 中（或设置 `dmPolicy: "open"`）
- 群组：确保 @提及了机器人（或设置 `requireMention: false`）
- 群组：检查 `groupAllowFrom` 是否包含你的用户 ID

**如何找到你的 KOOK 用户 ID：**
- 打开 KOOK → 点击你的头像 → 个人资料中会显示你的数字 ID

**触发频率限制（HTTP 429）：**
- KOOK 每日限制 10,000 条消息。插件会自动跟踪用量。
- 如果触及限制，等到北京时间 12:00 自动重置。

---

### Project Structure / 项目结构

```
openclaw-kook/
├── index.ts                 # Plugin entry point / 插件入口
├── openclaw.plugin.json     # Plugin manifest / 插件清单
├── package.json             # npm package config
├── tsconfig.json            # TypeScript config
├── LICENSE                  # MIT License
└── src/
    ├── channel.ts           # Main channel plugin definition / 频道插件定义
    ├── bot.ts               # Inbound message handling / 消息处理
    ├── ws-client.ts         # WebSocket client (connect/heartbeat/resume) / WS 客户端
    ├── client.ts            # KOOK REST API client / REST API 客户端
    ├── send.ts              # Send/update/delete messages / 消息发送
    ├── media.ts             # Media upload/download / 媒体处理
    ├── outbound.ts          # Outbound message adapter / 出站适配器
    ├── reply-dispatcher.ts  # Reply dispatch + block streaming / 回复调度+渐进输出
    ├── kmarkdown.ts         # Markdown ↔ KMarkdown conversion / 格式转换
    ├── card-builder.ts      # Card message builder / 卡片消息构建器
    ├── actions.ts           # Message tool actions / 消息工具操作
    ├── reactions.ts         # Emoji reactions / 表情回应
    ├── typing.ts            # Typing indicator (💭 reaction) / 输入指示
    ├── monitor.ts           # Provider lifecycle management / 生命周期管理
    ├── onboarding.ts        # Interactive setup wizard / 交互式配置向导
    ├── probe.ts             # Bot token validation / Token 验证
    ├── quota.ts             # Daily quota tracker / 配额追踪
    ├── policy.ts            # Access control policies / 访问控制策略
    ├── accounts.ts          # Account resolution / 账号解析
    ├── directory.ts         # User/guild directory / 用户/服务器目录
    ├── targets.ts           # Target ID normalization / 目标 ID 标准化
    ├── config-schema.ts     # Zod config schema / 配置 Schema
    ├── types.ts             # TypeScript type definitions / 类型定义
    └── runtime.ts           # Plugin runtime context / 运行时上下文
```

### Contributing / 参与贡献

Contributions welcome! Please open an issue or PR.

欢迎贡献！请提交 Issue 或 PR。

### License / 许可证

[MIT](LICENSE)
