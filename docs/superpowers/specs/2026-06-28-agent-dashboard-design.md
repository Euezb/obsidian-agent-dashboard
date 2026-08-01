# Agent Dashboard 设计规格

## 1. 项目目标

在 Windows 桌面版 Obsidian 中构建一个原生 `ItemView` 插件，将日常任务、最近笔记、Vault 健康度、笔记创建热力图、GitHub 日榜与周榜、每日 AI 新闻和 Codex 摘要集中在一个暖色编辑风工作台中。

插件只面向当前用户的 Windows 电脑，允许使用 Node.js 与 `child_process`，因此 `manifest.json` 使用 `isDesktopOnly: true`。

## 2. 项目位置

- Obsidian 程序：`<obsidian install>\Obsidian.exe`
- Vault：`<vault A>`
- 插件源码：`<source root>`
- 插件安装目录：`<vault A>\.obsidian\plugins\agent-dashboard`
- 插件缓存目录：`<vault A>\Dashboard\cache`
- 报告目录：`<vault A>\Reports`

源码位于 Vault 的隐藏 `.dev` 目录，避免被 Obsidian 当作普通笔记索引。构建产物部署到 `.obsidian/plugins/agent-dashboard`。

## 3. 产品原则

1. 今日工作优先：任务和最近笔记必须处于首屏最高层级。
2. 健康度必须可解释：总分同时提供扣分原因和可执行建议。
3. 资讯必须经过筛选：新闻和榜单不是原始数据倾倒。
4. 自动化必须安静：健康状态下不显示刷新、研究或检查按钮。
5. Codex 必须可控：自动摘要每天最多执行一次，不接受任意终端命令。
6. 局部失败不得拖垮整页。

## 4. 视觉设计

### 4.1 创意方向

创意基准为“The Morning Desk”。界面像每天早晨打开的一张整理好的私人书桌：温暖、安静、编辑感强，但仍然是高效可靠的产品界面。

明确避免：

- 深色赛博或终端风格。
- 普通 SaaS 等权重卡片墙。
- 夸张圆角、宽而虚的阴影、玻璃拟态和装饰性渐变。
- 页面加载编舞、视差和与状态无关的运动。

### 4.2 字体

- 大标题与主要分区标题：Georgia 或兼容衬线字体。
- 正文、控件、任务、元数据：Segoe UI 或 Obsidian 系统无衬线字体。
- 数字与变化值：使用 tabular figures，避免刷新时宽度跳动。
- 衬线字体禁止用于按钮、标签、状态文本和数据密集行。

### 4.3 色彩

- 主背景：暖米白。
- 表面：接近白色的暖中性色。
- 主文字：深棕黑。
- 品牌强调：克制的陶土橙，用于主要操作与少量重点。
- 状态与焦点：平静的钴蓝色，用于同步状态、链接和焦点环。
- 品牌色总面积控制在页面的 10% 以内。

正式实现时以 CSS 语义变量定义颜色，并验证正文对比度不低于 WCAG AA 4.5:1。

### 4.4 形状与层级

- 页面级容器最大圆角 16px。
- 内容表面圆角 12px。
- 按钮圆角 8px 到 10px。
- 标签可使用全圆角。
- 页面默认平面化，使用间距、浅色表面和稀疏分隔线建立层级。
- 阴影只允许出现在主按钮、弹层或明确悬浮状态，模糊半径不超过 8px。

## 5. 页面布局

采用已批准的“今日桌面”方案。

### 5.1 Header

- 左侧：`Agent Dashboard`、主标题“今天从这里开始”、一句功能说明。
- 右侧：自动更新状态和唯一显式主操作“新建日记”。
- 正常状态不显示“刷新资讯”“运行研究”“检查 Vault”按钮。
- 自动状态文案示例：`自动更新完成`、`09:42 更新`、`正在更新资讯`。

### 5.2 今日工作

- 左侧较宽区域显示今日任务。
- 右侧较窄区域显示最近笔记。
- 任务支持标准 Markdown 复选框 `- [ ]` 与 `- [x]`。
- 截止日期识别 `📅 YYYY-MM-DD`。
- 数据范围为全 Vault Markdown 文件，不依赖 Tasks 插件。
- 点击任务复选框时使用 `Vault.process()` 修改原始任务行；文件已变化或定位失败时停止写入并提示用户打开源笔记处理。
- 最近笔记按 `mtime` 降序排列，默认显示三到五篇。

### 5.3 Vault 脉搏

- 左侧显示健康度总分、与上周变化、建议数量。
- 右侧显示过去一年笔记创建热力图、活跃日统计和少到多图例。
- 热力图必须提供可键盘访问的日期和值信息，不能只依赖颜色。
- 健康度由固定规则计算，包括 frontmatter、链接、标签、孤立笔记、长期未更新和 Inbox 积压。

健康度满分 100，固定分为：frontmatter 完整度 20 分、链接与孤立笔记 25 分、标签组织 15 分、最近 90 天活跃度 20 分、Inbox 积压 20 分。每项按符合条件的笔记比例线性计分，并同时输出扣分原因。空 Vault 不显示误导性的零分，而显示“数据不足”和建库指引。

### 5.4 今日发现

使用左右双栏：

- 左侧较宽：每日 AI 新闻，显示标题、中文摘要、来源数量与阅读时间。
- 右侧较窄：GitHub 榜单，模块内部切换日榜和周榜。
- 榜单显示仓库名、简短描述、星标增长或排名依据。
- 日榜与周榜切换不得重新加载整页。

### 5.5 窄窗口

在视图宽度小于约 820px 时：

- Header 改为纵向排列。
- 今日任务与最近笔记改为单列。
- 健康度与热力图改为单列。
- AI 新闻与 GitHub 榜单改为单列，AI 新闻在前。
- 热力图列数减少，但保持日期顺序和可读性。

## 6. 自动刷新策略

### 6.1 页面打开

1. 立即并行读取本地 Vault 数据与缓存。
2. 先显示本地数据和可用缓存，不等待网络或 Codex。
3. 缓存过期时在后台局部刷新对应模块。
4. 数据到达后只更新相关模块，禁止整页闪烁。

### 6.2 刷新频率

- Vault 任务、最近笔记、健康度、热力图：每次打开立即扫描。
- GitHub 日榜与周榜：缓存超过一小时才联网刷新。
- RSS 与 Hacker News：缓存超过一小时才联网刷新。
- Codex 每日新闻摘要：自然日内最多自动运行一次。

### 6.3 Vault 事件

监听 Markdown 文件的创建、修改、删除和重命名事件。事件经过防抖后只刷新本地模块，禁止触发外部网络请求或 Codex 任务。

### 6.4 并发

同一种刷新任务只允许一个实例运行。多个打开或重复事件共享同一个运行中的 Promise，避免重复请求、重复写缓存或重复启动 Codex。

## 7. 数据源与缓存

### 7.1 本地 Vault

使用 Obsidian 官方公开 API：

- `app.vault.getMarkdownFiles()`
- `app.vault.cachedRead()`
- `app.metadataCache`
- `app.vault.on(...)`
- `Vault.process()` 或安全的创建 API

目录按需创建：

- `Daily/`
- `Inbox/`
- `Reports/`
- `Dashboard/cache/`

打开插件本身不得创建目录。只有对应功能首次写入时才创建。

### 7.2 外部资讯

- GitHub：请求 `https://github.com/trending?since=daily` 与 `https://github.com/trending?since=weekly` 并解析榜单。页面结构变化导致解析失败时，降级到 GitHub Search API，以窗口起始日期和 `pushed` 条件筛选活跃仓库，再按 stars 排序；降级结果必须标注“活跃高星项目”，不能冒充官方 Trending。
- AI 新闻：开箱即用数据来自 Hacker News Top Stories 中与 AI、Agent、LLM、模型和开发工具相关的条目；用户可在设置页添加 RSS/Atom 源。Codex 基于这些来源生成每日中文摘要。
- 外部请求使用 Obsidian `requestUrl()`，不得在 UI 打开时阻塞主线程。

### 7.3 缓存文件

- `Dashboard/cache/github-daily.json`
- `Dashboard/cache/github-weekly.json`
- `Dashboard/cache/ai-news-sources.json`
- `Dashboard/cache/ai-news-summary.json`
- `Dashboard/cache/vault-health.json`
- `Dashboard/cache/refresh-state.json`

每个缓存记录 `schemaVersion`、`generatedAt`、`source` 和数据主体。读取时执行运行时校验；格式不合法时隔离损坏文件并重新生成。

## 8. Codex 集成

### 8.1 前提

安装可从普通 Windows 进程调用的独立 Codex CLI，并完成登录。当前 Codex App 内部可执行文件不能作为插件 runner 的最终路径。

### 8.2 Runner

插件通过 Node.js `child_process.spawn()` 调用本地 runner，runner 再执行 `codex exec`。

只允许预定义任务 ID，例如：

- `daily-ai-brief`
- `deep-research`
- `vault-lint-explanation`

插件不得接受用户输入的任意可执行文件名、Shell 参数或拼接命令字符串。

### 8.3 安全

- 不使用跳过审批与沙箱的危险参数。
- Codex 工作目录限制在 Vault 或专用任务目录。
- 输出路径由任务定义决定，用户输入不能逃逸目标目录。
- 每次运行记录任务 ID、开始时间、结束时间、退出码和输出文件。
- 插件卸载或关闭时终止仍在运行的子进程。

### 8.4 输出

每日摘要写入缓存供 Dashboard 展示；需要长期保存的研究报告写入 `Reports/`。插件监听写回事件并局部刷新。

“新建日记”创建 `Daily/YYYY-MM-DD.md`。文件已存在时直接打开；不存在时使用包含 `Tasks` 与 `Notes` 分区的内置模板创建后打开。

## 9. 组件与代码边界

- `AgentDashboardPlugin`：插件生命周期、命令、Ribbon、设置页和 `ItemView` 注册。
- `AgentDashboardView`：视图生命周期与根状态绑定。
- `RefreshCoordinator`：统一编排本地扫描、缓存、外部请求与 Codex 任务。
- `VaultScanner`：任务、最近笔记、健康度和热力图。
- `FeedService`：GitHub、RSS 和 Hacker News。
- `CacheRepository`：版本化 JSON 缓存与原子写入。
- `CodexRunner`：预定义 Agent 任务、进程生命周期与日志。
- `DashboardState`：每个模块的 `idle/loading/ready/stale/error` 状态。
- `renderHeader`、`renderToday`、`renderVaultPulse`、`renderDiscovery`：小型、可替换的原生 DOM 渲染函数。

不引入 React、Tailwind、Bootstrap、shadcn 或图表库。热力图使用原生 DOM/CSS。微动效优先使用 CSS transition 或 WAAPI；只有需要协调多元素刷新序列时才引入 GSAP。

## 10. 动效规范

- 主按钮按压：100到150ms，`scale(0.97)`。
- 日榜与周榜切换：180ms 交叉淡入。
- 数字和新增列表项：150到250ms 状态过渡。
- 列表 stagger 间隔不超过 50ms，且不阻塞交互。
- 禁止 `transition: all`、`scale(0)`、`ease-in` 和布局属性动画。
- 只动画 transform 与 opacity。
- `prefers-reduced-motion: reduce` 下移除位置变化，仅保留必要的颜色或透明度反馈。
- 页面打开不执行编排式入场动画。

## 11. 状态与异常

### 11.1 加载

优先显示缓存。无缓存时使用与最终布局尺寸一致的 skeleton，避免布局偏移。

### 11.2 空状态

- 没有任务：说明如何创建标准 Markdown 任务。
- 没有最近笔记：提供“新建日记”入口。
- 没有热力图数据：解释创建笔记后将如何出现统计。
- 没有资讯缓存：显示正在获取来源，不显示空白模块。

### 11.3 错误

- 网络失败：显示旧缓存，并标记“暂时使用缓存”。
- GitHub 限流：显示旧榜单和下次可更新时间。
- Codex 不可用：保留新闻来源列表，显示“今日摘要尚未生成”和设置入口。
- 单模块错误：其他模块保持可用。
- 正常状态不显示重试按钮；失败状态在相关模块内提供重试。

## 12. 设置

设置页至少包含：

- Daily、Inbox、Reports 和 Cache 目录。
- RSS/Atom 源列表。
- 外部缓存 TTL，默认一小时。
- 是否自动生成每日 Codex 摘要，默认开启。
- Codex CLI 路径与检测状态。
- GitHub Token 的可选 SecretStorage 引用，用于提高 API 限额。
- 重新生成缓存与清理损坏缓存的维护操作。

## 13. 测试与验收

### 13.1 单元测试

- Markdown 任务解析和日期识别。
- 最近笔记排序。
- 健康度规则和分数解释。
- 热力图日期分桶。
- 缓存 TTL 与 schema 校验。
- GitHub 日榜/周榜映射。
- RefreshCoordinator 并发去重。

### 13.2 集成测试

使用假的 Vault、`requestUrl` 和进程适配器验证：

- 打开视图时先缓存后刷新。
- 外部失败时使用旧缓存。
- Codex 每日最多运行一次。
- 写回缓存与报告路径正确。
- 插件关闭时清理事件和子进程。

### 13.3 构建

- `npm run build`
- 项目存在 lint 脚本时运行 `npm run lint`
- 测试框架只作为开发依赖，不增加插件生产运行依赖。

### 13.4 Obsidian 实机验收

- 部署到 `<vault A>\.obsidian\plugins\agent-dashboard`。
- 验证启用、关闭、重启和恢复视图。
- 验证宽窗口与窄窗口。
- 验证完整键盘导航、焦点、对比度和减少动态效果。
- 验证离线、损坏缓存、GitHub 限流和 Codex 缺失。
- 验证自动刷新不会重复启动请求或 Codex。

## 14. 分阶段交付

1. 初始化 Obsidian sample plugin 与项目规范。
2. 构建静态暖色 Dashboard 原型。
3. 迁移为 Obsidian `ItemView`，使用 mock 数据。
4. 接入任务、最近笔记、健康度与热力图。
5. 接入 GitHub 日榜/周榜、RSS 与 Hacker News 缓存。
6. 安装和检测独立 Codex CLI，接入每日摘要 runner。
7. 完成错误状态、设置页、测试、实机验收与文档。

每个阶段必须保持插件可构建、可打开、可单独验收。

## 15. 非目标

- 不支持移动端、macOS 或 Linux。
- 不支持 Claude Code、OpenCode 或 Hermes。
- 不在第一版接入 Reddit、邮箱或 YouTube。
- 不自动删除、移动或归档用户笔记。
- 不提供任意 Shell 命令输入框。
- 不在后台定时运行；自动刷新只在 Dashboard 打开或 Vault 事件触发时发生。
