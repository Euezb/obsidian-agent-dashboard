import type { TarotAssetResolver } from "./tarotFace";
import type { DivinationReadingPort } from "./divinationReading";

/**
 * 「卜筮」板块的会话状态。
 *
 * 面板会在每次整页重渲染(资讯到达、5 分钟心跳)时整体重建 DOM,
 * 所以每个方法面板的私有状态(表单值、上次结果、错误)都存放在这里,
 * 由 view 持有、由面板自己读写,避免用户的起卦结果被一次心跳冲掉。
 */
export interface XuanxueSessionState {
  /** 当前选中的方法 id。 */
  activeMethod: string;
  /** 方法 id → 该面板的私有状态。 */
  readonly panels: Map<string, Record<string, unknown>>;
}

export function createXuanxueSessionState(): XuanxueSessionState {
  return { activeMethod: "xiaoliuren", panels: new Map() };
}

/** 取出某个面板的私有状态,由面板模块负责收敛自己的键。 */
export function panelStorage(
  session: XuanxueSessionState,
  id: string,
): Record<string, unknown> {
  const existing = session.panels.get(id);
  if (existing !== undefined) return existing;
  const created: Record<string, unknown> = {};
  session.panels.set(id, created);
  return created;
}

/**
 * 面板的计算上下文。
 *
 * 面板的计算是异步收尾的;这段时间里可能发生整页重渲染(资讯到达 / 5 分钟心跳),
 * 旧面板的宿主脱离文档后,结果画进去也看不见。
 * 所以异步收尾时必须调用 `onSettled()`:板块据此判断自己是否还活着,
 * 已失效就请视图重渲染一次,把 storage 里已有的结果画出来。
 */
export interface BusiPanelContext {
  onSettled(): void;
  /**
   * 塔罗牌面素材地址;宿主给不出时面板降级成占位牌面(版面尺寸不变)。
   * 只有塔罗面板用得到,其余面板忽略。
   */
  resolveAsset?: TarotAssetResolver;
  /**
   * 大模型解卦;宿主没配(总开关关掉、设置里没填接口、或单测没给)时不传,
   * 各面板据此只出卦象、不出解卦块 —— 面板自身不碰设置与网络。
   */
  reading?: DivinationReadingPort;
}

/** 直接调用面板(例如单测)时的空上下文。 */
export const NOOP_PANEL_CONTEXT: BusiPanelContext = { onSettled: () => undefined };

/**
 * 一个卜筮方法面板。
 *
 * 实现约定:
 * - 只读写传入的 storage(跨重渲染保留),不触碰模块级可变状态;
 * - 计算走 taibu-core,失败把错误信息写回 storage 并在结果区展示;
 * - 异步计算收尾后调用 `ctx?.onSettled()`;
 * - 事件监听必须返回清理函数,由宿主在切换方法/卸载时调用。
 */
export interface BusiPanel {
  readonly id: string;
  readonly label: string;
  render(
    host: HTMLElement,
    storage: Record<string, unknown>,
    ctx?: BusiPanelContext,
  ): () => void;
  /**
   * 可选:宿主被丢弃前,把当前表单值写回 storage。
   * 整页重渲染(每个资讯模块到达、5 分钟心跳)都会重建面板 DOM,
   * 没有这一步,用户还没提交就在输入框里的内容会被连带清掉。
   */
  harvest?(host: HTMLElement, storage: Record<string, unknown>): void;
}
