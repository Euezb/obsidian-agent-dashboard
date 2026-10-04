import type { BusiPanelContext } from "../../features/divination/bushiTypes";
import type { DivinationReadingRequest } from "../../features/divination/divinationReading";
import {
  renderDivinationReadingNote,
  type DivinationReadingStatus,
} from "../renderDivinationReading";

/**
 * 卜筮面板共用的「解卦块」。
 *
 * 九个面板的骨架是一样的:填表 → 计算 → 把结果写进 storage → 在结果卡片正文里画出来。
 * 解卦只是这条链路的尾巴,所以尾巴只写一次:
 *
 *   // render() 里建一次(需要 storage 与 ctx)
 *   const reading = createReadingSlot({ host, storage: raw, ctx, build: () => … });
 *   // renderResult() 里,把卦象画完之后:
 *   reading?.paintInto(card.body);
 *   // 计算成功后:
 *   reading?.request();
 *
 * 它负责:未配置时给一行说明、请求中占位、失败给重试、结果就地刷新,
 * 以及「这次结果还算不算数」—— 用户又起了一卦时,旧请求回来不许盖新的。
 */

export interface ReadingSlotState {
  status: DivinationReadingStatus;
  text?: string;
  message?: string;
}

export interface ReadingSlotOptions {
  /** 面板宿主(取 ownerDocument)。 */
  host: HTMLElement;
  /** 面板 storage:解卦状态存在 reading 字段里,跨整页重渲染保留。 */
  storage: { reading?: ReadingSlotState };
  ctx?: BusiPanelContext;
  /** 结果就绪时给出解卦请求;结果还没算出来、或已被清掉时返回 null。 */
  build: () => DivinationReadingRequest | null;
  /** 竖签文字,缺省「解卦」;塔罗传「解牌」。 */
  label?: string;
  /** 口径小字(模型名 · 生成时间);缺省不显示。 */
  meta?: () => string;
}

export interface ReadingSlot {
  /**
   * 把解卦块画进结果卡片正文。每次 renderResult 都要调一次 ——
   * 结果区是整块重建的,上一次画出来的节点已经被丢掉了。
   */
  paintInto(container: HTMLElement): void;
  /** 结果算好后调用:发起请求并就地刷新;同一卦已有结果则直接画。 */
  request(): void;
}

function describeFailure(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return "解卦失败，可稍后重试。";
}

export function createReadingSlot(options: ReadingSlotOptions): ReadingSlot {
  const doc = options.host.ownerDocument;
  let target: HTMLElement | null = null;

  const stateOf = (): ReadingSlotState => options.storage.reading ?? { status: "idle" };

  const paint = (): void => {
    if (target === null) return;
    target.replaceChildren();
    renderDivinationReadingNote(
      target,
      {
        ...stateOf(),
        meta: options.meta?.(),
        onRetry: () => request(),
      },
      { label: options.label },
    );
  };

  const paintInto = (container: HTMLElement): void => {
    target = doc.createElement("div");
    target.className = "ad-bp-reading";
    container.append(target);
    paint();
  };

  /** 这次请求还算不算数:用户又起了一卦(种子变了)或结果被清掉时,旧回调不许写回。 */
  const stillCurrent = (cacheKey: string): boolean =>
    options.build()?.cacheKey === cacheKey;

  const request = (): void => {
    const port = options.ctx?.reading;
    const payload = options.build();
    if (payload === null) return;
    if (port === undefined) {
      // 宿主没给解卦能力(单测、或宿主没接线):只出卦象。
      options.storage.reading = { status: "idle" };
      return;
    }
    if (!port.isConfigured()) {
      // 面板是用户主动起卦的:要说清为什么没有解卦,而不是静悄悄。
      options.storage.reading = {
        status: "off",
        message: "解卦未开启：设置 → 卜筮 → 卜筮解卦，并填好直连 API 摘要。",
      };
      paint();
      return;
    }
    options.storage.reading = { status: "loading" };
    paint();
    void port
      .read(payload)
      .then((text) => {
        if (!stillCurrent(payload.cacheKey)) return;
        options.storage.reading = { status: "ready", text };
      })
      .catch((error: unknown) => {
        if (!stillCurrent(payload.cacheKey)) return;
        options.storage.reading = { status: "error", message: describeFailure(error) };
      })
      .finally(() => {
        if (!stillCurrent(payload.cacheKey)) return;
        paint();
        options.ctx?.onSettled();
      });
  };

  return { paintInto, request };
}
