# Ceryx v1.0 Phase 5 - TG17 账号系统可行性评估

更新日期：2026-06-06  
评估对象：Ceryx 账号系统与多设备管理  
结论状态：已评估，v1.0 不建议引入账号系统

## 1. 结论摘要

Ceryx 当前的核心价值是：

- iPad / Desktop 作为控制端
- Windows Agent 作为执行端
- 设备配对建立信任
- 本地存储 token 与 settings
- 不依赖云端存储用户内容

在这个前提下，账号系统不是当前版本的必要条件。  
**TG17 的最终建议是：v1.0 不引入账号系统，继续采用设备级配对 + 直连同步的零服务器架构。**

如果未来确实出现以下需求，再考虑引入账号层：

- 一个人绑定多台 Agent 主机
- iPad / Desktop 共享同一套配对信息
- settings / shortcut / gesture profile 跨设备同步
- 临时共享、访客权限、团队协作

## 2. 当前状态

当前仓库已经具备：

- 设备配对与 trusted device 存储
- token hash 鉴权
- 本地 SQLite 持久化
- 客户端 settings / shortcut / gesture 配置
- 双端控制台

但是没有：

- 统一用户账号
- 云端设备目录
- 云端设置同步
- 账号权限中心
- 跨设备共享管理后台

也就是说，当前 Ceryx 是一个**设备信任模型**，不是一个**账号中心模型**。

## 3. 需求场景

### 3.1 多 Agent 管理

- 一个账号绑定多台 Agent（例如家中 Windows + 办公室 macOS）
- iPad 自动发现全部绑定设备

### 3.2 多控制端同步

- iPad 和 Desktop 共享同一套配对关系
- settings、shortcut profile、gesture profile 在设备间同步

### 3.3 权限与共享

- 主账号与访客账号
- 只读预览 vs 完全控制
- 临时分享链接（例如 5 分钟）

### 3.4 数据边界

- 不需要云端保存 Codex 屏幕内容
- 只需要同步：
  - paired devices
  - settings
  - shortcut / gesture profile
  - 一些最小的设备元数据

## 4. 方案对比

### 4.1 方案 A：自建账号（邮箱 + 密码 + OTP）

优点：

- 完全掌控身份体系
- 可独立构建用户、设备、权限模型
- 适合后续做团队协作和高级权限

缺点：

- 工作量最高
- 需要密码哈希、找回密码、邮件发送、OTP、风控
- 需要处理更多合规与安全责任
- 对 v1.0 来说明显过重

结论：

- 不适合作为当前版本方案

### 4.2 方案 B：OAuth 社交登录（Google / Apple / GitHub）

优点：

- 不需要自己维护密码系统
- 用户登录体验更轻
- 适合做“薄账号层”，再叠加设备同步
- 对开发者用户来说接受度较高

缺点：

- 依赖第三方身份提供方
- 需要处理 token 生命周期与 provider 差异
- 仍然需要自己的后端来保存设备关系与设置同步

结论：

- 如果未来必须上账号系统，B 是最合理的第一选择
- 但它仍然不是 v1.0 的必需项

### 4.3 方案 C：无账号 + 设备间直连同步

优点：

- 零服务器账号成本
- 保留当前产品的简洁性
- 与现有设备配对模型天然兼容
- 用户无需再记住一套新的登录体系

缺点：

- 多设备迁移和共享能力有限
- 不适合真正的云端多设备管理
- 临时分享和团队协作能力较弱

结论：

- **这是 v1.0 的推荐路线**
- 与当前产品价值和用户体验最一致

## 5. 推荐架构（仅作为未来预案）

如果未来必须引入账号系统，建议的最小架构不是“完整用户平台”，而是：

- OAuth 身份层
- 极简同步服务
- 只同步必要 metadata
- 不同步 Codex 内容本体
- 敏感数据使用端到端加密

### 5.1 身份层

优先级建议：

1. Apple
2. Google
3. GitHub

理由：

- Apple / Google / GitHub 都有成熟 OAuth / OpenID Connect 文档
- 对开发者用户可接受度较高
- 能避免自行实现密码系统

### 5.2 同步层

仅同步：

- paired_devices
- settings
- shortcut profiles
- gesture profiles
- 最小设备元数据

不建议同步：

- 屏幕帧
- 输入事件流
- Prompt 内容
- 日志全文

### 5.3 安全边界

- 云端不保存 token 明文，只保存 hash
- 设备同步 payload 应该加密
- 可选的分享链接必须有时效和权限边界
- 用户应能删除自己的云端数据

## 6. 成本与依赖评估

| 方案 | 开发成本 | 运维成本 | 数据风险 | 用户摩擦 | 推荐度 |
| --- | --- | --- | --- | --- | --- |
| A 自建账号 | 高 | 中-高 | 中 | 中 | 低 |
| B OAuth 登录 | 中 | 低-中 | 中 | 低 | 中-高（未来） |
| C 无账号直连同步 | 低 | 低 | 低 | 低 | **最高（当前）** |

### 6.1 现成身份提供方的可用性

- Apple 的 Sign in with Apple 文档明确支持 iOS / macOS / 网站，并可用于相关网站与跨平台应用。
- GitHub OAuth Apps 官方文档明确支持 OAuth 应用授权。
- Google 的 Identity Services 文档表明其新身份方案已经接替旧的 Google Sign-In，并推荐基于 OpenID Connect / OAuth 2.0 的流程。

这说明：**如果未来要做账号系统，技术上是成熟可行的**。  
但可行不等于当前就应该上。

## 7. 决策建议

### 7.1 v1.0 决策

- 不引入账号系统
- 继续保持设备级 pairing + 直连同步
- 优先把多窗口、质量、诊断、跨网等核心远控体验做好

### 7.2 v1.1+ 触发条件

只有在出现以下真实信号后，才建议重启账号项目：

- 用户明确要求多设备自动同步
- 团队/访客共享频繁出现
- 设备迁移成本成为主要痛点
- 需要云端统一管理多个 Agent

### 7.3 如果未来必须启动账号系统

- 优先采用方案 B（OAuth）
- 只做薄账号层，不做完整用户平台
- 同步范围严格限制在元数据和 settings
- 保持 Ceryx 的隐私与零内容存储原则

## 8. 参考资料

- Apple - Sign in with Apple：
  - https://developer.apple.com/documentation/SigninwithApple
  - https://developer.apple.com/sign-in-with-apple/get-started
  - https://developer.apple.com/sign-in-with-apple/usage-guidelines-for-websites-and-other-platforms/
- GitHub OAuth Docs：
  - https://docs.github.com/en/apps/oauth-apps/using-oauth-apps
  - https://docs.github.com/en/developers/apps/creating-an-oauth-app
- Google Identity Services：
  - https://developers.google.com/identity/sign-in/web/sign-in
  - https://developers.google.com/identity/openid-connect/openid-connect

