import { BUSHI_PANELS } from "./bushi/registry";
import {
  panelStorage,
  type BusiPanel,
  type BusiPanelContext,
  type XuanxueSessionState,
} from "../features/divination/bushiTypes";
import type { TarotAssetResolver } from "../features/divination/tarotFace";
import type { DivinationReadingPort } from "../features/divination/divinationReading";
import { createElement } from "./domHelpers";
import { renderSectionHead } from "./renderSectionHead";

export interface BushiRenderOptions {
  /** 跨重渲染保留的会话状态(选中方法、各面板表单与结果)。 */
  session: XuanxueSessionState;
  /** 塔罗牌面素材地址;缺省时牌面降级成占位。 */
  resolveAsset?: TarotAssetResolver;
  /** 大模型解牌;缺省或未配置时塔罗面板只出牌面。 */
  reading?: DivinationReadingPort;
  /**
   * 面板计算收尾、而本板块已脱离文档时回调。
   * 视图收到后重渲染一次即可显示 storage 里已经算好的结果。
   */
  onSettled?: () => void;
}

/**
 * 「卜筮」板块:一个方法切换器 + 一个面板宿主。
 * 面板自身负责计算与局部重渲染;板块只负责切换、状态保持与清理。
 */
export function renderBushi(
  container: HTMLElement,
  options: BushiRenderOptions,
): () => void {
  const { session } = options;
  container.replaceChildren();
  container.className = "ad-section ad-bushi";
  container.dataset.region = "bushi";

  // 批注:本地可用的方法数(全部离线计算)。
  renderSectionHead(container, "卜筮", { meta: `${BUSHI_PANELS.length} 法` });

  const note = createElement(container, "p");
  note.className = "ad-bushi__note";
  note.textContent = options.reading?.isConfigured() === true
    ? "本地起卦 · 解卦由大模型生成（可在设置里关） · 结果不入缓存"
    : "本地计算 · 不联网 · 结果不入缓存";

  const switcher = createElement(container, "div");
  switcher.className = "ad-segmented ad-bushi__switcher";
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", "卜筮方法");

  const panelHost = createElement(container, "div");
  panelHost.className = "ad-bushi__panel";

  const knownIds = new Set(BUSHI_PANELS.map((panel) => panel.id));
  if (BUSHI_PANELS.length > 0 && !knownIds.has(session.activeMethod)) {
    const fallback = BUSHI_PANELS[0];
    if (fallback !== undefined) session.activeMethod = fallback.id;
  }

  let cleanupPanel: () => void = () => undefined;
  let currentPanel: BusiPanel | null = null;
  /** 每次面板渲染递增;异步收尾时用它判断这次渲染是否还是当前那次。 */
  let renderToken = 0;
  const detachers: Array<() => void> = [];

  /**
   * 面板被丢弃前把用户没提交的输入收回 storage。
   * 整页重渲染会重建整块 DOM,不采集就等于把用户正在打的内容丢掉。
   */
  function harvestCurrentPanel(): void {
    const panel = currentPanel;
    if (panel?.harvest === undefined) return;
    try {
      panel.harvest(panelHost, panelStorage(session, panel.id));
    } catch {
      // 采集失败不能阻断卸载:宁可丢这一次输入,也不能让面板卡在旧状态。
    }
  }

  for (const panel of BUSHI_PANELS) {
    const button = createElement(switcher, "button");
    button.type = "button";
    button.textContent = panel.label;
    button.dataset.method = panel.id;
    button.setAttribute("aria-pressed", String(panel.id === session.activeMethod));
    const select = (): void => selectMethod(panel.id);
    button.addEventListener("click", select);
    detachers.push(() => button.removeEventListener("click", select));
    switcher.append(button);
  }

  function markActive(id: string): void {
    for (const child of Array.from(switcher.children)) {
      const method = (child as HTMLElement).dataset.method;
      child.setAttribute("aria-pressed", String(method === id));
    }
  }

  function renderPanel(id: string): void {
    const panel = BUSHI_PANELS.find((entry) => entry.id === id);
    if (panel === undefined) return;
    session.activeMethod = id;
    harvestCurrentPanel();
    cleanupPanel();
    currentPanel = panel;
    renderToken += 1;
    const token = renderToken;
    const context: BusiPanelContext = {
      resolveAsset: options.resolveAsset,
      reading: options.reading,
      onSettled: () => {
        // 已被切换或重建:结果留在 storage 里,等下一次渲染自然显示。
        if (token !== renderToken) return;
        // 本板块还在文档里,面板已经就地画好了结果。
        if (panelHost.isConnected) return;
        // 板块已被整页重渲染换掉:请视图重建一次。
        options.onSettled?.();
      },
    };
    cleanupPanel = panel.render(panelHost, panelStorage(session, id), context);
    markActive(id);
  }

  function selectMethod(id: string): void {
    // 点击已激活的方法只做视觉刷新,不重建面板(避免表单被清空)。
    if (id === session.activeMethod) {
      markActive(id);
      return;
    }
    renderPanel(id);
  }

  renderPanel(session.activeMethod);
  container.append(note, switcher, panelHost);

  const cleanup = (): void => {
    harvestCurrentPanel();
    cleanupPanel();
    for (const detach of detachers) detach();
  };
  return cleanup;
}
