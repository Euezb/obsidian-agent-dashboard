import type { DashboardState, DashboardTask, RecentNote, TrendingRepo } from "../domain/types";
import type { RetryableExternalModule } from "../features/feeds/FeedService";
import type { AlmanacCard } from "../features/divination/almanacCard";
import type { XuanxueSessionState } from "../features/divination/bushiTypes";
import type { DailyFortune } from "../features/divination/dailyFortune";
import type { TarotAssetResolver } from "../features/divination/tarotFace";
import type { DivinationReadingPort } from "../features/divination/divinationReading";
import { createElement } from "./domHelpers";
import { renderDiscovery } from "./renderDiscovery";
import { renderFortune } from "./renderFortune";
import { renderHeader } from "./renderHeader";
import { renderToday } from "./renderToday";
import type { TodayInteractionState } from "./renderToday";
import { renderVaultPulse } from "./renderVaultPulse";
import { renderBushi } from "./renderBushi";
import type { DivinationReadingViewState } from "./renderDivinationReading";

export interface DashboardRenderCallbacks {
  updatedAt?: number;
  status: string;
  onNewDiary: () => void;
  onToggleTask?: (task: DashboardTask) => void;
  onOpenNote?: (note: RecentNote) => void;
  /** User-owned local view state (reveal toggle, collapsed groups) that outlives a re-render. */
  interaction?: TodayInteractionState;
  /** Persisted width of the 最近笔记 column; the 今天 divider writes it back. */
  todayNotesWidth?: number;
  onTodayNotesWidthChange?: (width: number) => void;
  /** Persisted width of the GitHub 榜单 column inside 今日发现. */
  discoveryRankingWidth?: number;
  onDiscoveryRankingWidthChange?: (width: number) => void;
  onRetry?: (module: RetryableExternalModule) => void;
  onOpenSettings?: () => void;
  rankingPeriod?: "daily" | "weekly";
  onRankingPeriodChange?: (period: "daily" | "weekly") => void;
  /** AI 新闻里「摘要 / 新闻」的页签选择(原先是上下堆叠)。 */
  newsView?: "brief" | "list";
  onNewsViewChange?: (view: "brief" | "list") => void;
  onCancelDailyBrief?: () => void;
  isRepoRelevant?: (repo: TrendingRepo) => boolean;
  /** 头部黄历卡;缺省或 null 时不渲染。 */
  almanac?: AlmanacCard | null;
  /**
   * 「今日运势」的算据(每日单抽 + 小六壬时课)。
   * 与卜筮同一个总开关:缺省时整块不渲染。
   */
  fortune?: DailyFortune;
  /** 塔罗牌面素材地址解析;今日运势与卜筮塔罗共用,缺省时牌面降级成占位。 */
  resolveTarotAsset?: TarotAssetResolver;
  /** 今日一牌的大模型解牌;缺省时不渲染这一块,页脚也保持「本地计算」。 */
  fortuneReading?: DivinationReadingViewState;
  /** 卜筮的解卦能力(九个方法共用);缺省时各面板只出卦象。 */
  divinationReading?: DivinationReadingPort;
  /** 「卜筮」板块会话;缺省时整个板块不渲染(保持既有面板的测试契约)。 */
  bushi?: { session: XuanxueSessionState };
  /**
   * 卜筮面板的计算收尾时,若板块已被整页重渲染替换,视图据此重建一次面板,
   * 让已经算好、存在会话里的结果显示出来。
   */
  onBushiSettled?: () => void;
}

/** 板块 id：增量渲染以「块」为单位判断要不要重画。 */
type SectionId = "header" | "fortune" | "today" | "pulse" | "discovery" | "bushi";

/** 页面上板块的固定顺序,同时决定这次要保留哪些节点。 */
const SECTION_ORDER: readonly SectionId[] = [
  "header",
  "fortune",
  "today",
  "pulse",
  "discovery",
  "bushi",
];

interface SectionEntry {
  /** 这一块渲染所依赖的数据,逐个按身份比较。 */
  deps: readonly unknown[];
  node: HTMLElement;
  cleanup: () => void;
}

/**
 * 跨次渲染保留的板块缓存。
 *
 * 视图持有它并一路传进来；不传时每次都是新建的缓存，等价于「整页重建」的旧行为
 * （渲染函数的既有调用方与测试因此不需要改动）。
 */
export interface DashboardRenderCache {
  inner: HTMLElement | null;
  sections: Map<SectionId, SectionEntry>;
}

export function createDashboardRenderCache(): DashboardRenderCache {
  return { inner: null, sections: new Map() };
}

/**
 * 依赖逐个按「同一性」比较。
 *
 * 数据层每次状态推送都换新对象（applyLocalScan / updateModule 都是这样），所以
 * 身份没变就等于这一块的内容没变：热力图、今天、运势这些板块不用跟着资讯推送
 * 重画一遍。回调刻意不进依赖：传入的回调大多是视图现造的箭头函数，每次身份都不同，
 * 但它们都只是对同一个视图实例的转发，行为不会变；把它们算进去会让所有板块永远重画。
 */
function sameDeps(previous: readonly unknown[], next: readonly unknown[]): boolean {
  return previous.length === next.length && previous.every((dep, index) => dep === next[index]);
}

export function renderDashboard(
  container: HTMLElement,
  state: DashboardState,
  callbacks: DashboardRenderCallbacks,
  cache: DashboardRenderCache = createDashboardRenderCache(),
): () => void {
  container.classList.add("agent-dashboard");
  if (cache.inner === null || !container.contains(cache.inner)) {
    // 首次渲染，或容器被外部清空过（视图关闭后再打开）：整棵子树连同板块缓存一起重建。
    cache.sections.clear();
    container.replaceChildren();
    cache.inner = createElement(container, "div");
    cache.inner.className = "agent-dashboard__inner";
  }
  const inner = cache.inner;
  container.append(inner);

  const drop = (id: SectionId): void => {
    const entry = cache.sections.get(id);
    if (entry === undefined) return;
    entry.cleanup();
    entry.node.remove();
    cache.sections.delete(id);
  };

  const mount = (
    id: SectionId,
    tag: "header" | "section",
    deps: readonly unknown[],
    render: (node: HTMLElement) => () => void,
  ): void => {
    const previous = cache.sections.get(id);
    // 数据没变：保留现有 DOM，连它的事件监听与拖拽状态一起留着。
    if (previous !== undefined && sameDeps(previous.deps, deps)) return;
    if (previous !== undefined) drop(id);
    const node = createElement(inner, tag);
    // 先挂载、再渲染子块：分栏宽度之类要量布局的东西在离屏树上量出来恒为 0。
    inner.append(node);
    cache.sections.set(id, { deps, node, cleanup: render(node) });
  };

  mount("header", "header", [callbacks.updatedAt, callbacks.status, callbacks.almanac], (node) =>
    renderHeader(node, callbacks.updatedAt, callbacks.status, callbacks.onNewDiary, callbacks.almanac));

  if (callbacks.fortune === undefined) {
    drop("fortune");
  } else {
    mount(
      "fortune",
      "section",
      [callbacks.fortune, callbacks.fortuneReading, callbacks.resolveTarotAsset],
      (node) => renderFortune(node, callbacks.fortune as DailyFortune, {
        resolveAsset: callbacks.resolveTarotAsset,
        reading: callbacks.fortuneReading,
      }),
    );
  }

  mount(
    "today",
    "section",
    [state.tasks, state.recentNotes, callbacks.todayNotesWidth, callbacks.interaction],
    (node) => renderToday(
      node,
      state.tasks,
      state.recentNotes,
      callbacks.onToggleTask,
      callbacks.onOpenNote,
      { notesWidth: callbacks.todayNotesWidth, onNotesWidthChange: callbacks.onTodayNotesWidthChange },
      callbacks.interaction,
    ),
  );

  mount("pulse", "section", [state.health, state.heatmap], (node) => {
    renderVaultPulse(node, state.health, state.heatmap);
    return () => undefined;
  });

  mount(
    "discovery",
    "section",
    [
      state.aiNews,
      state.githubDaily,
      state.githubWeekly,
      state.dailyBrief,
      callbacks.rankingPeriod,
      callbacks.newsView,
      callbacks.discoveryRankingWidth,
    ],
    (node) => renderDiscovery(
      node,
      state.aiNews,
      state.githubDaily,
      state.githubWeekly,
      state.dailyBrief,
      {
        onRetry: callbacks.onRetry,
        onOpenSettings: callbacks.onOpenSettings,
        rankingPeriod: callbacks.rankingPeriod,
        onRankingPeriodChange: callbacks.onRankingPeriodChange,
        newsView: callbacks.newsView,
        onNewsViewChange: callbacks.onNewsViewChange,
        onCancelDailyBrief: callbacks.onCancelDailyBrief,
        isRepoRelevant: callbacks.isRepoRelevant,
        rankingWidth: callbacks.discoveryRankingWidth,
        onRankingWidthChange: callbacks.onDiscoveryRankingWidthChange,
      },
    ),
  );

  if (callbacks.bushi === undefined) {
    drop("bushi");
  } else {
    mount(
      "bushi",
      "section",
      [callbacks.bushi.session, callbacks.resolveTarotAsset, callbacks.divinationReading],
      (node) => renderBushi(node, {
        session: callbacks.bushi?.session as XuanxueSessionState,
        resolveAsset: callbacks.resolveTarotAsset,
        reading: callbacks.divinationReading,
        onSettled: callbacks.onBushiSettled,
      }),
    );
  }

  // 重画的板块是追加进去的，这里统一按固定顺序排一遍（append 已存在的子节点只是移动）。
  const ordered = SECTION_ORDER
    .map((id) => cache.sections.get(id)?.node)
    .filter((node): node is HTMLElement => node !== undefined);
  inner.append(...ordered);

  return () => {
    for (const entry of cache.sections.values()) entry.cleanup();
    cache.sections.clear();
    cache.inner?.remove();
    cache.inner = null;
  };
}
