import type { TarotCardResult } from "taibu-core/tarot";
import {
  describeTarotFace,
  tarotAssetPath,
  TAROT_BACK_FILE,
  type TarotAssetResolver,
} from "../features/divination/tarotFace";

/**
 * 塔罗牌面与读牌文字:「今日运势」与「卜筮 · 塔罗」共用同一套。
 *
 * 牌面结构 = 纸垫(frame)+ 翻转容器(flip)+ 正反两面(face)。
 * 逆位只把正面那张图转 180°,角标的「逆」不跟着转 —— 牌倒过来也读得出。
 * 素材拿不到(非文件系统 Vault、文件缺失)时不退回文字表,而是画一张写着牌名的占位牌,
 * 版面尺寸不变,不会因为一张图掉了整块塌掉。
 */

export type TarotFaceSize = "sm" | "md" | "lg" | "xl";

export interface TarotFaceOptions {
  size?: TarotFaceSize;
  resolveAsset?: TarotAssetResolver;
  /** true 时先给牌背,调用 reveal() 再翻到正面(动画本身由 CSS 控制)。 */
  animate?: boolean;
  /**
   * 凯尔特十字的第 2 张:整张牌转 90° 横压在中心牌上。
   * 只旋转牌面本身,牌位文字不跟着转。
   */
  crossing?: boolean;
}

export interface TarotFaceView {
  root: HTMLElement;
  /** 翻到正面;未开启动画时是无副作用的空操作。 */
  reveal(): void;
}

/** 一次抽牌结果的最小输入;单测可以直接喂字面量。 */
export type TarotFaceInput = Pick<
  TarotCardResult,
  "card" | "orientation" | "number" | "reversedKeywords"
>;

/** 逆位取逆位关键词,正位取正位关键词。 */
export function tarotKeywords(drawn: TarotFaceInput): readonly string[] {
  const reversed = drawn.reversedKeywords ?? [];
  if (drawn.orientation === "reversed" && reversed.length > 0) return reversed;
  return drawn.card.keywords;
}

function assetUrl(
  resolve: TarotAssetResolver | undefined,
  file: string,
): string | null {
  if (resolve === undefined) return null;
  try {
    return resolve(tarotAssetPath(file));
  } catch {
    // 宿主拿不到地址不该让整个面板挂掉。
    return null;
  }
}

export function createTarotFace(
  doc: Document,
  drawn: TarotFaceInput,
  options: TarotFaceOptions = {},
): TarotFaceView {
  const size = options.size ?? "md";
  const face = describeTarotFace(drawn);
  const reversed = drawn.orientation === "reversed";
  const orientationText = reversed ? "逆位" : "正位";

  const root = doc.createElement("figure");
  root.className = `ad-card ad-card--${size}${reversed ? " ad-card--reversed" : ""}` +
    (options.crossing === true ? " ad-card--crossing" : "");
  root.dataset.revealed = String(options.animate !== true);

  const frame = doc.createElement("div");
  frame.className = "ad-card__frame";
  if (reversed) {
    const badge = doc.createElement("span");
    badge.className = "ad-card__rev";
    badge.textContent = "逆";
    badge.title = "逆位";
    frame.append(badge);
  }

  const flip = doc.createElement("div");
  flip.className = "ad-card__flip";

  const back = doc.createElement("div");
  back.className = "ad-card__face ad-card__face--back";
  const backUrl = assetUrl(options.resolveAsset, TAROT_BACK_FILE);
  if (backUrl !== null) {
    const backImage = doc.createElement("img");
    backImage.className = "ad-card__img";
    backImage.src = backUrl;
    backImage.alt = "";
    backImage.setAttribute("aria-hidden", "true");
    back.append(backImage);
  }

  const front = doc.createElement("div");
  front.className = "ad-card__face ad-card__face--front";
  const frontUrl = face === null ? null : assetUrl(options.resolveAsset, face.file);
  if (frontUrl === null) {
    // 占位牌面:牌名照样给出,只是没有画面。
    const pending = doc.createElement("div");
    pending.className = "ad-card__face--pending";
    pending.textContent = drawn.card.nameChinese;
    front.append(pending);
  } else {
    const image = doc.createElement("img");
    image.className = "ad-card__img";
    image.src = frontUrl;
    image.alt = `${drawn.card.nameChinese} · ${orientationText}`;
    image.decoding = "async";
    front.append(image);
  }

  flip.append(back, front);
  frame.append(flip);
  root.append(frame);

  return {
    root,
    reveal: () => {
      root.dataset.revealed = "true";
    },
  };
}

export interface TarotReadingOptions {
  /** 牌位,例如「过去」「今日一牌 · 单牌阵」。 */
  position: string;
  /** 补充口径,例如「元素风 · 每日 0 点换牌」;空串不渲染。 */
  meta?: string;
  /** 关键词上限,牌阵里格子窄,默认 5。 */
  keywordLimit?: number;
}

/** 牌面旁的读牌文字:位置 · 名(正/逆)· 英文名 · 关键词 · 补充口径。 */
export function createTarotReading(
  doc: Document,
  drawn: TarotFaceInput,
  options: TarotReadingOptions,
): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "ad-reading";

  const positionLine = doc.createElement("p");
  positionLine.className = "ad-reading__position";
  positionLine.textContent = options.position;
  wrap.append(positionLine);

  const name = doc.createElement("p");
  name.className = "ad-reading__name";
  name.textContent = drawn.card.nameChinese;
  const orientation = doc.createElement("small");
  orientation.textContent = drawn.orientation === "reversed" ? "逆位" : "正位";
  name.append(orientation);
  wrap.append(name);

  const english = doc.createElement("p");
  english.className = "ad-reading__en";
  english.textContent = drawn.card.name;
  wrap.append(english);

  const keywords = tarotKeywords(drawn).slice(0, options.keywordLimit ?? 5);
  if (keywords.length > 0) {
    const chips = doc.createElement("div");
    chips.className = "ad-bp-chips";
    for (const keyword of keywords) {
      const chip = doc.createElement("span");
      chip.className = "ad-bp-chip";
      chip.textContent = keyword;
      chips.append(chip);
    }
    wrap.append(chips);
  }

  if (options.meta !== undefined && options.meta !== "") {
    const metaLine = doc.createElement("p");
    metaLine.className = "ad-reading__meta";
    metaLine.textContent = options.meta;
    wrap.append(metaLine);
  }

  return wrap;
}

/** 按索引错开翻牌,一次抽多张时像发牌而不是一起闪;返回计时器,供宿主清理。 */
export function revealTarotFaces(
  faces: readonly TarotFaceView[],
  staggerMs = 70,
): number[] {
  const timers: number[] = [];
  faces.forEach((face, index) => {
    timers.push(
      window.setTimeout(() => {
        face.reveal();
      }, 60 + index * staggerMs),
    );
  });
  return timers;
}

export interface TarotSlotReadingOptions {
  /** 牌位序号(1 起),真阵里靠它把读序钉住 —— 几何占了版面,序号负责说清谁先谁后。 */
  index: number;
  position: string;
  /** 关键词上限,格子窄,默认 2 个。 */
  keywordLimit?: number;
}

/**
 * 真阵里的紧凑读牌:牌位序号 + 牌位名 + 牌名(正/逆)+ 至多两个关键词。
 *
 * 完整的读牌(英文名、全部关键词)在等宽排版里放得下,摆成阵以后每格只有一张牌宽,
 * 再堆四行文字会把阵压垮;所以真阵里只留读序与牌名,
 * 完整关键词挂在格子与牌的 title 上(悬停可见)。
 */
export function createTarotSlotReading(
  doc: Document,
  drawn: TarotFaceInput,
  options: TarotSlotReadingOptions,
): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "ad-reading ad-reading--slot";

  const positionLine = doc.createElement("p");
  positionLine.className = "ad-reading__slot";
  const index = doc.createElement("span");
  index.className = "ad-reading__slot-index";
  index.textContent = String(options.index);
  const position = doc.createElement("span");
  position.textContent = options.position;
  positionLine.append(index, position);
  wrap.append(positionLine);

  const name = doc.createElement("p");
  name.className = "ad-reading__slot-name";
  name.textContent = drawn.card.nameChinese;
  const orientation = doc.createElement("small");
  orientation.textContent = drawn.orientation === "reversed" ? "逆位" : "正位";
  name.append(orientation);
  wrap.append(name);

  const keywords = tarotKeywords(drawn).slice(0, options.keywordLimit ?? 2);
  if (keywords.length > 0) {
    const keyLine = doc.createElement("p");
    keyLine.className = "ad-reading__slot-key";
    keyLine.textContent = keywords.join(" · ");
    wrap.append(keyLine);
  }

  return wrap;
}

export interface TarotPileView {
  root: HTMLElement;
  /** 按读序给出牌面句柄,交给调用方错开翻牌。 */
  faces: TarotFaceView[];
}

/**
 * 叠成一摞的牌(凯尔特十字的第 1、2 张):1 立着,2 横过来压在它上面。
 * 牌位文字由调用方排在摞下面 —— 文字跟着牌转 90° 就没法读了。
 */
export function createTarotPile(
  doc: Document,
  cards: readonly TarotFaceInput[],
  options: TarotFaceOptions & { crossingIndex: number },
): TarotPileView {
  const pile = doc.createElement("div");
  pile.className = "ad-spread__pile";
  const faces: TarotFaceView[] = [];
  cards.forEach((drawn, index) => {
    const face = createTarotFace(doc, drawn, {
      size: options.size,
      resolveAsset: options.resolveAsset,
      animate: options.animate,
      crossing: index === options.crossingIndex,
    });
    faces.push(face);
    pile.append(face.root);
  });
  return { root: pile, faces };
}
