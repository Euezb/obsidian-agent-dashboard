# agent-dashboard 源码审查报告（2026-09-30）

- **审查方式**：只读静态审查（四区分区：视图层 / feeds / vault+settings / 卜筮），关键发现逐条对源码行复核，标〔已核〕者为复核通过。
- **范围**：`src/` 全部 TS 文件 + `tests/` 佐证；未修改/创建/删除任何源码文件（本文档除外）。
- **总体评价**：架构分层清晰（domain → features → infrastructure → view），缓存事务写（temp→replace→backup）、XSS 面（全目录无 `innerHTML`）、`LocalDashboardController` 的 generation+revision 设计均扎实。问题集中在：异步守卫缺失、判据粒度过粗、派生值与缓存键解耦不当、读-改-写竞态四类。

---

## A. 高危 bug（6）

### A1. [高][bug] 八字解卦「当前大运」恒取上一步（off-by-one）〔已核〕
- 位置：`src/view/bushi/baziPanel.ts:87`（`readingFactsOf`）；依据 `src/features/divination/dayun.ts:9`
- 证据：`const current = dayun.list[index - 1];` 而 `dayun.ts:9` 明言 `@returns 命中步的下标`；同文件 `:350` `const isCurrent = index === currentIndex;` 按原下标用
- 影响：解卦提示词里「当前大运」恒为前一步；人在第一步大运时 `list[-1]`=undefined，该事实静默消失
- 建议：改 `dayun.list[index]` 并保留 `index < 0` 判断

### A2. [高][bug] splitHandle 存量栏宽被 clamp 到 720px〔已核〕
- 位置：`src/view/splitHandle.ts:40-47`（`maxWidth`/`clampWidth`）、`:66-71`；根因 `src/view/renderState.ts:70-135`
- 证据：`return total > 0 ? … : FALLBACK_MAX_WIDTH;`（=720）；`createElement`（`domHelpers.ts:9-14`）只建节点不挂载，`renderSplitHandle` 在 `inner.append(...)` 之前测量 `layout`，`getBoundingClientRect()` 恒为 0
- 影响：持久化宽度 >720px 时每次重渲染被重置 720px 并回弹，`aria-valuemax` 错报；`dashboardRender.test.ts:331-393` 只测 400/380 覆盖不到
- 建议：初始应用 stored 时跳过上限 clamp，或 append 挂载后再 measure

### A3. [高][bug] 文件缓存把派生字段冻结在首次读取时刻〔已核〕
- 位置：`src/features/vault/VaultScanner.ts:107-111`（缓存命中分支）与 `:125-130`
- 证据：缓存键仅 `cached.mtime === file.stat.mtime && cached.size === file.stat.size`，但 `isActive: file.stat.mtime >= activeThreshold` 依赖当次 `activityCutoff(scanTime)`（跨天变），`isInbox: isPathWithin(file.path, settings.inboxFolder)` 依赖可改设置，三个 metadata 标志依赖 `metadataCache.getFileCache`（索引是否滞后于 modify 事件「未确认」）
- 影响：跨天/改 inboxFolder 后活跃度、收件箱、frontmatter/链接/标签计数持续失真，直到该文件再被修改
- 建议：三类派生值移出缓存结果，在 `:142` 聚合循环按当次 scanTime/settings 重算（缓存只留 tasks/note/createdAt）

### A4. [高][bug] 手动「重试摘要」被在途自动摘要劫持成伪失败〔已核〕
- 位置：`src/features/feeds/FeedService.ts:200-202`（retry/dailyBrief 分支）与 `:384-389`（`maybeAutoSummary` 的 runOnce 工作函数）；`src/infrastructure/RefreshCoordinator.ts:23-24`
- 证据：两路径共用 `dailyBriefKey`（`FeedService.ts:53`）但契约不同——手动 `if (brief === undefined) throw new Error("unavailable")`，自动门禁可 `return undefined`
- 影响：手动点击恰逢门禁阶段即被去重到自动 promise，报「今日摘要生成失败（原因：unavailable）」且根本未生成
- 建议：手动路径用独立 RefreshKey，或 join 到 undefined 时自行再 runOnce

### A5. [高][bug] 归档幂等去重用子串匹配，短任务永不归档〔已核〕
- 位置：`src/view/AgentDashboardView.ts:445`（`archiveOldCompletedTasks`）
- 证据：`carryOver.filter((text) => !content.includes(\`- [x] ${text}\`))` —— `- [x] 买牛奶和鸡蛋` 包含 `- [x] 买牛奶`
- 影响：互为前缀的任务被误判已归档，静默漏归档
- 建议：按 `content.split(/\r?\n/)` 行级精确比较

### A6. [高][bug] 任务日期取整个路径的首个日期，与注释和 archiveTasks 口径冲突〔已核〕
- 位置：`src/features/vault/VaultScanner.ts:43`（`NOTE_DATE_IN_PATH` 对 `file.path` 整体匹配）、`:120`
- 证据：注释写 "date-in-filename"，而 `src/features/vault/archiveTasks.ts:18-27` 明确「never from a folder name」且做 `isCalendarDate` 校验
- 影响：`2026-09-28/会议.md` 的任务被错打日期并在 renderToday 按日分组；`2026-02-30` 非法日期也通过
- 建议：只对 basename 取日期并复用 `isCalendarDate`

---

## B. 中危（12）

### B1. [中][bug] 紫微星卡把 undefined 渲染成文字并误挂化象样式〔已核〕
- 位置：`src/view/bushi/ziweiPanel.ts:141-142`（`renderPalaceCell`）
- 证据：`${star.brightness === "" ? "" : \` ${star.brightness}\`}`、`if (star.mutagen !== "") line.classList.add("ad-zw-star--mutagen")`；taibu-core `brightness?: string; mutagen?: string` 为可选，同文件 `:56` 却写 `star.brightness !== undefined && star.brightness !== ""`
- 影响：字段缺失时星行出现「 undefined」、非化象星标红（库是否总给空串「未确认」）
- 建议：判空改 `star.brightness == null || star.brightness === ""`（mutagen 同）

### B2. [中][bug] 9 个面板异步排盘无过期结果守卫
- 位置：`src/view/bushi/tarotPanel.ts:304-316`（`void calculateTarot(input).then((output) => { raw.result = output; …`）及 `fortunePanel.ts:389` 等同构（taiyi/daliuren/liuyao/bazi/ziwei/hepan 写法相同）
- 证据：无 token/seed 比对；taibu-core `calculateTarotData`、`calculateDailyAlmanac` 为真异步
- 影响：连点两次抽牌/排运时后完成的旧响应覆盖新结果并触发翻牌
- 建议：对齐 `readingSlot.stillCurrent`，落盘前比对本次 seed/请求序号

### B3. [中][bug] 解卦槽 stillCurrent 判据不含问事文本
- 位置：`src/view/bushi/readingSlot.ts:88-89`；`xiaoliurenPanel.ts:57`、`taiyiPanel.ts:316`、`daliurenPanel.ts:235` 等 cacheKey
- 证据：`const stillCurrent = (cacheKey) => options.build()?.cacheKey === cacheKey;` 而 xiaoliuren cacheKey 为 `` `${storage.lunarMonth ?? ""}|${storage.lunarDay ?? ""}|${storage.hour ?? ""}` ``（不含 question）
- 影响：仅改占问文本重起同一课时，旧解卦仍被判「当前」写回并绘制
- 建议：cacheKey 拼上 question，或 stillCurrent 改比完整请求

### B4. [中][bug] fortunePanel 起排不清 reading，日/月共用同一解卦状态
- 位置：`src/view/bushi/fortunePanel.ts:358-380`（submit）、`:336-341`（`createReadingSlot`）
- 证据：submit 内无 `raw.reading = undefined`（对照 `xiaoliurenPanel.ts:213`、`tarotPanel.ts:294` 均有），`storage: raw` 且 `readingRequestOf` 按 `storage.isMonth` 分叉
- 影响：切日运↔月运或重查时旧解卦文本（请求失败则持续）挂在新结果下
- 建议：submit 开头重置 `raw.reading`，或按 day|month 分两个状态槽

### B5. [中][bug] 设置 apiSummarizer 三输入框队列外读-改-写，连续修改丢字段〔已核〕
- 位置：`src/settings/AgentDashboardSettingTab.ts:173-176 / 196-199 / 210-213`
- 证据：spread `{...this.dashboardPlugin.settings.apiSummarizer, …}` 在 change 事件时刻求值，写入却排在 `SettingsPersistenceQueue.update`（`SettingsPersistenceQueue.ts:10-19`）后才落 `this.settings[key]`；`:101-106` 推荐订阅按钮对 `rssFeeds` 同病
- 影响：改完地址马上改模型，第二次提交用旧对象整体覆盖，地址改动静默丢失
- 建议：spread 移入 persist 回调、执行时刻再读 settings

### B6. [中][bug] mergeSettings 对非法文件夹列表整体丢弃，反放宽扫描范围
- 位置：`src/settings/settings.ts:139-148`
- 证据：`if (parsed.ok) settings[key] = parsed.folders;` 而 `parseVaultFolderLines`（`settingsValidation.ts:50-64`）一行非法返回 `{ok:false, folders:[]}` → `taskExcludeFolders` 落回默认 `[]`，此前排除项全部消失（与该函数「never widen the scan scope silently」注释相反）
- 建议：逐行丢弃非法行或保留旧值并告警，至少 `taskExcludeFolders` 不得回退为空

### B7. [中][bug] providerBaseURL 无类型守卫，损坏 data.json 令插件加载抛 TypeError〔已核〕
- 位置：`src/settings/settingsValidation.ts:139` → `:124` `value.trim()`
- 证据：同函数 `:143` `model`、`:144` `apiKeyEnv` 都有 `typeof === "string"` 守卫，唯独 `value.providerBaseURL ?? ""` 没有（`??` 不挡数字/对象）；`settings.ts:174-181` 只做 `isRecord`
- 影响：`providerBaseURL` 为非字符串时 `mergeSettings → loadSettings` 崩溃，整个插件不可用
- 建议：`typeof value.providerBaseURL === "string" ? value.providerBaseURL : ""`

### B8. [中][bug] parseTasks 不识别围栏代码块
- 位置：`src/features/vault/taskParser.ts:62-74`
- 证据：逐行循环无 fence 状态机，`archiveHeadingLevel(source)` / `TASK_LINE.exec(source)` 对代码块内行照常生效（围栏符号在源码中无任何处理，grep 无 ``` 状态跟踪）
- 影响：``` 内 `- [ ] 示例` 进待办；块内 `## 归档` 使其后任务全被打上 `task.archived = true`（`:101-103`），连带影响 `AgentDashboardView.ts:433` 跨日归档选择
- 建议：跟踪 ``` / ~~~ 开闭，围栏内整行跳过

### B9. [中][bug] ribbon 徽标绑定编辑前的在跑扫描
- 位置：`src/main.ts:231`（`void this.refreshRibbonBadge()`）→ `:351` `scanner.scan()`
- 证据：视图用 `scanFresh()`，`VaultScanner.ts:68-78` 注释明言 `scan()` 会复用编辑前启动的扫描
- 影响：徽标未完成数与面板不一致且无后续事件纠正
- 建议：`refreshRibbonBadge` 改用 `scanFresh()`（或与视图共享同一 promise）

### B10. [中][bug] 批级校验一票否决：单条坏数据丢整批
- 位置：`src/features/feeds/FeedService.ts:328-332`（`refreshAiNewsAndCache`）、`src/features/feeds/hackerNews.ts:113-115`（`parseTopIds`）
- 证据：`result.status === "fulfilled" && isNewsItemArray(result.value) ? result.value : []`；`if (!ids.every(…)) return undefined`；对照 `FeedService.ts:774` `combineNews` 的逐条过滤成死代码
- 影响：任一条目/id 不合规即丢弃整个来源（整批新闻或整个 top50）
- 建议：批级 guard 改逐条 filter（复用 combineNews 逻辑），parseTopIds 用 filter 替代 every

### B11. [中][bug] maybeAutoSummary 用入口快照回写，并发结果被覆盖
- 位置：`src/features/feeds/FeedService.ts:350`（快照）→ `:380`（回写）
- 证据：`let fallbackBrief = state.dailyBrief.data;` 回写 `update({ status: "error", data: fallbackBrief, … })`；对照 `:393-394` 另一分支有 `isCurrentBrief` 复查
- 影响：`readStableAttemptGate` 的 `store.get()` 慢读期间（代码自设跨午夜场景）完成的手动重试被旧快照+error 覆盖
- 建议：`:380` 回写前同样复查 `isCurrentBrief(this.authoritativeState?.dailyBrief.data, …)`

### B12. [中][bug] CacheRepository 在校验前删除 backup〔已核〕
- 位置：`src/infrastructure/CacheRepository.ts:112-118`（先 `remove(backupPath)`）→ `:119-128`（才 read/parse，损坏进 quarantine）
- 证据：删除发生在 JSON.parse 与 envelope 校验之前；`tests/cacheRepository.test.ts:118` 只覆盖「final 有效清 backup」，未覆盖「final 损坏 + backup 有效」
- 影响：final 损坏且 backup 有效时，唯一好副本已被删，数据无法恢复
- 建议：校验通过后再删 backup；补该组合回归测试

---

## C. 低危与资源清理（10）

| # | 严重度/类别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| C1 | 低/健壮性 | `ExternalDashboardController.ts:24-34, 36-46` | `open()` 递增 generation 使在途 retry 结果静默作废，面板可能停在 loading | open() 合并/接管在途 retry 的 generation |
| C2 | 低/健壮性 | `AgentDashboardView.ts:239-253, 326-338` | `refreshFortune`/`refreshAlmanac` 无在途去重、无 token，旧响应可盖新（对照 `:276-277` `fortuneReadingToken`） | 照 refreshFortuneReading 加 token |
| C3 | 低/健壮性 | `splitHandle.ts:78-104` + `AgentDashboardView.ts:380-382` | 拖拽中重渲染销毁 handle，`draggedWidth` 未回调，宽度不持久化并回弹 | 拖拽中推迟重渲染 |
| C4 | 低/健壮性 | `splitHandle.ts:91-104` | 不处理 pointercancel/lostpointercapture，`dragging` 卡 true、window 监听滞留到下次 pointerup 或视图销毁 | finishDrag 同绑 pointercancel |
| C5 | 低/bug | `AgentDashboardView.ts:202-205` | onOpen 重复进入覆盖 `archiveTimer` 句柄（赋值前未 clear），旧 timer 空跑 | 赋值前 clearTimeout |
| C6 | 低/健壮性 | `liuyaoPanel.ts:480-497`；`hepanPanel.ts:230-239, 315-317` | 六爻用神 chips 重画无界累积 detachers；hepan cleanup 漏调 `genderControl.cleanup()`（对照 `taiyiPanel.ts:377`）违反 `bushiTypes.ts:66` 清理契约 | paintTargets 前清 detachers；hepan 补两次 segmented.cleanup() |
| C7 | 低/bug | `src/view/renderDivinationReading.ts:73, 90` | 「逐条」行解析遇含空格/超 14 字标签失配即 `inRows = false`，其后各行全退化为段落 | 失配行不重置 inRows，仅标题行切换 |
| C8 | 低/健壮性 | `taiyiPanel.ts:315-316` | 缓存键含分钟与注释「日粒度」不符，日/月/年家同一盘重复取解卦 | 非 hour/minute 模式键只取 `dateValue.slice(0,10)` |
| C9 | 低/bug | `AgentDashboardSettingTab.ts:62`；`FeedService.ts:202, 428` | TTL 输入框清空静默存成 15（`Number("")===0` 被钳制）；手动重试错误直出英文 "unavailable"，且手动成功不调 `recordSummaryDay`（对照 `:284-296`） | 空串显式拒绝；中文原因；手动成功也 mark(date) |
| C10 | 低/性能 | `ObsidianRequestPort.ts:40-47`；`githubTrending.ts:152-157`；`hackerNews.ts:15` | 超时无 abort 通道，挂起请求累积（规模「未确认」）；findPeriodStars 字符类含空格可跨数字贪婪匹配（线上触发「未确认」）；AI 关键词 "model" 泛匹配非 AI 标题 | 统计未决请求+短时熔断；收紧字符类；model 需与 ai/llm 同现 |

---

## D. 架构与效率（8）

1. **[高][性能] 每次状态推送全量重建整页 DOM** — `AgentDashboardView.ts:370-416`（`contentEl.empty()` → `renderDashboard`），含 365 天热力图 ~420 节点（`renderVaultPulse.ts:171-185`）；`FeedService.open` 一次发 4-6 个 state、每 5 分钟 tick（`main.ts:244-248`）各重建一轮。建议按 section 状态指纹增量重建，收益最大并顺带消除 C3。
2. **[中][性能] 每个 md 事件全库扫描，无面板时也扫** — `main.ts:227-241` → `:351 scanner.scan()`；`VaultScanner.ts:88-91` 每次 `getMarkdownFiles().filter().sort()`，`compareVaultPaths`（`:227-235`）每比较 2 次 `normalizeForComparison`。建议面板关闭时跳过徽标扫描或增量维护计数、排序键预计算。
3. **[中][性能] renderState 双重清空 + 离屏构造** — `renderState.ts:68` 与 `AgentDashboardView.ts:381` 重复；`:122-135` 先渲染后 append，是 A2 测量为 0 的根因。建议删一处清空、先 append 再渲染子块。
4. **[中][架构] 视图类承担数据编排/缓存/持久化** — `AgentDashboardView.ts:96-115`（almanacCard/fortuneReadingToken/archiveTimer 三套私有状态）+ `:239-338` 三套 refresh + `:55-86` localStorage + `:428-459` 归档写盘。建议抽第三个 controller 统一 generation 语义，视图只留 render。
5. **[中][性能] 解卦服务缓存无上限、无并发去重** — `DivinationReadingService.ts:35, 53-61`，纯 Map 只增不减、同键并发重复调模型。建议 Promise 去重 + LRU 定长淘汰（如 50）。
6. **[低][架构] 工具函数多份重复** — 本地日期键 4 处（`externalDashboardState.ts:71-77`、`FeedService.ts:619`、`VaultScanner.ts:249`、`almanacCard.ts:96`，另有 `heatmap.ts:55`、`VaultActions.ts:189`）；`mapWithConcurrency` 2 份逐字相同（`rss.ts:111-128`、`hackerNews.ts:92-109`）；`isCalendarDate` 3 份（`FeedService.ts:753`、`ApiSummarizerService.ts:109`、`githubTrending.ts:208`）。建议抽 domain 层单源。
7. **[低][架构] 层关系倒置与硬编码** — `RequestPort` 类型定义在 `githubTrending.ts` 被 `hackerNews.ts:2`、`rss.ts:2`、`ApiSummarizerService.ts:3` 反向 import；vault 缓存路由名单仅 `main.ts:113-117` 硬编码无测试锚定（`RoutedFeedCache.ts:25-27`）；harvest 与渲染双写 aria-label 字符串（`bushiUi.ts:243-256` + `xiaoliurenPanel.ts:154/:251`）。建议类型移入 infrastructure、名单下沉常量层、标签提为面板级常量。
8. **[低][架构] 死代码与浅克隆** — `AgentDashboardView.ts:356-358` `todayKey()` 全库零调用；`recentNotes.ts:3` `selectRecentNotes` 无调用方（漏接线还是废弃「未确认」）；`SettingsPersistenceQueue.ts:37-38` `cloneValue` 不克隆 `apiSummarizer` 嵌套对象，回滚语义依赖「永远整体替换顶层键」的隐含约定。建议删除死代码、确认接线、cloneValue 递归。

---

## 共同点

1. **异步结果缺 generation/token 守卫是最大重复病灶**（B2/B4/C1/C2/B11 共 5 处）：Local/External 控制器已有正确范式（generation+revision），视图三路 refresh、9 个面板 submit、摘要回写都没抄。建议统一成一个「请求序号+落盘前比对」小工具。
2. **判据粒度过粗**：A5 子串、A6 全路径取日期、B10 批级一票否决、B8 围栏不识别——同一类「用粗匹配代替精确状态」错误。
3. **派生值/键与时变输入解耦不当**：A3 冻结派生字段、B3 cacheKey 缺 question、C8 键粒度漂移、D6 日期键四份实现，都属于「键/缓存没涵盖全部输入」。
4. **读-改-写竞态**：B5 设置输入框、B11 快照回写，共性是「事件时刻捕获旧对象、异步落地整体覆盖」。
5. **清理契约执行不一致**：C4/C5/C6 + 9 个面板的错误/空态与监听清理各自手写（卜筮面板结构同构但重复实现）。
6. **工程面良好资产**：无 innerHTML、缓存事务写（temp→replace→backup）、错误脱敏（`errorDetail.ts:4-5` `SECRET_SPANS`）扎实，重构时别动。

---

## 最少改动点（按性价比排序）

| 序 | 改动 | 规模 | 消除 |
|---|---|---|---|
| 1 | `baziPanel.ts:87` `dayun.list[index - 1]` → `dayun.list[index]` | 一行 | A1 |
| 2 | splitHandle 初始应用 stored 跳过上限 clamp（或先 append 再 measure） | 三行 | A2（+D3 部分） |
| 3 | 派生字段移出 `CachedScanEntry`，聚合循环重算 | ~10 行 | A3 |
| 4 | `includes` 改行级精确匹配；任务日期只对 basename 取 | 各两行 | A5、A6 |
| 5 | 手动重试独立 RefreshKey | ~5 行 | A4 |
| 6 | spread 移入 persist 回调；`typeof value.providerBaseURL === "string"` | ~6 行 + 一行 | B5、B7 |
| 7 | `refreshRibbonBadge` 改 `scanFresh()` | 一行 | B9 |
| 8 | 中等重构（放最后）：D1 按板块增量渲染、D6 工具函数单源化 | 重构 | D1、D6 |

---

*本文档由 2026-09-30 只读审查汇总生成；〔已核〕条目为逐条对源码行复核结论，其余证据引自对应源码行；出现频率或线上触发条件存疑处已标「未确认」。*
