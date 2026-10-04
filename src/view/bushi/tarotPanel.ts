import { calculateTarot, TAROT_SPREADS } from "taibu-core/tarot";
import type { TarotCardResult, TarotInput, TarotOutput } from "taibu-core/tarot";
import type { BusiPanel } from "../../features/divination/bushiTypes";
import {
  SHAPED_SPREAD_CLASS,
  slotArea,
  spreadLayoutOf,
  spreadSlots,
  type SpreadLayout,
} from "../../features/divination/spreadLayout";
import type { TarotAssetResolver } from "../../features/divination/tarotFace";
import type { DivinationReadingRequest } from "../../features/divination/divinationReading";
import { spreadTarotFacts } from "../../features/divination/tarotFacts";
import { createReadingSlot, type ReadingSlot, type ReadingSlotState } from "./readingSlot";
import { requestTokenFor } from "./panelToken";
import {
  createTarotFace,
  createTarotPile,
  createTarotReading,
  createTarotSlotReading,
  revealTarotFaces,
  tarotKeywords,
  type TarotFaceView,
} from "../renderTarotFace";
import {
  collectError,
  createCheckboxField,
  createField,
  createPanelNotice,
  createResultCard,
  createSelectField,
  createSubmitButton,
  createTextField,
  readCheckboxValue,
  readInputValue,
  type SelectOption,
} from "./bushiUi";

interface TarotStorage {
  question?: string;
  spreadType?: string;
  allowReversed?: boolean;
  result?: TarotOutput;
  error?: string;
  busy?: boolean;
  /** 解牌:跟着 result 走,抽一次新牌就重置。缓存在服务里,这里只存状态。 */
  reading?: ReadingSlotState;
}

function spreadOptions(): SelectOption[] {
  return TAROT_SPREADS.map((spread) => ({ value: spread.id, label: spread.name }));
}

function elementMeta(drawn: TarotCardResult): string {
  const element = drawn.element;
  return element === undefined ? "" : `元素${element}`;
}

/** 抽牌时刻,写进解牌请求当口径。 */
function momentText(now: Date): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}

/** 解牌请求:整副牌 + 所问之事。发不发「问题」由服务按设置决定,面板不问设置。 */
function readingRequestOf(output: TarotOutput): DivinationReadingRequest {
  return {
    kind: "method",
    method: "tarot",
    // 种子即这次抽牌:同一副牌重渲染不重取,换一次牌才重算。
    cacheKey: output.seed,
    momentText: momentText(new Date()),
    question: output.question ?? "",
    facts: spreadTarotFacts(output.cards),
  };
}

function readingMeta(storage: TarotStorage): string {
  const result = storage.result;
  if (result === undefined) return "";
  return `${result.spreadName} · ${result.cards.length} 张`;
}

/**
 * 结果区:
 * - 单牌沿用原来的排版(牌面加大、读牌文字在右侧);
 * - 多张牌按牌阵几何铺开 —— 凯尔特十字摆成十字+权杖、马蹄形成弧线、抉择分叉;
 *   真阵里每张牌下面只留紧凑读牌,完整关键词挂在格子 title 上;
 * - 解牌(题签)接在牌阵下方,失败时给重试。
 * 返回牌面句柄,交给调用方决定什么时候翻牌。
 */
function renderResult(
  host: HTMLElement,
  storage: TarotStorage,
  options: {
    resolveAsset?: TarotAssetResolver;
    animate: boolean;
    reading?: ReadingSlot;
  },
): TarotFaceView[] {
  const doc = host.ownerDocument;
  const holder = doc.createElement("div");
  holder.className = "ad-bp-panel__result";
  const faces: TarotFaceView[] = [];

  if (storage.error !== undefined) {
    holder.append(createPanelNotice(host, "error", storage.error));
  } else if (storage.result !== undefined) {
    const { spreadName, question, cards } = storage.result;
    if (cards.length === 0) {
      holder.append(createPanelNotice(host, "empty", "没有抽到牌面。"));
    } else {
      // 没填问题时不拼「 · undefined」:库在没传 question 时给的是 undefined,不是空串。
      const asked = question === undefined || question === "" ? "" : ` · ${question}`;
      const card = createResultCard(host, `${spreadName}${asked}`);
      const first = cards[0];
      const layout = cards.length > 1 ? spreadLayoutOf(storage.result.spreadId) : null;

      if (cards.length === 1 && first !== undefined) {
        const single = doc.createElement("div");
        single.className = "ad-spread ad-spread--single";
        const face = createTarotFace(doc, first, {
          size: "xl",
          resolveAsset: options.resolveAsset,
          animate: options.animate,
        });
        faces.push(face);
        single.append(face.root);
        single.append(
          createTarotReading(doc, first, { position: first.position, meta: elementMeta(first) }),
        );
        card.body.append(single);
      } else {
        const drawn = renderSpread(doc, cards, layout, options);
        card.body.append(drawn.root);
        faces.push(...drawn.faces);
      }

      if (cards.length > 0) {
        // 解牌单独放一个容器:抽牌后原地只换这一块,不重画牌面 ——
        // 否则翻牌动画刚起步就被整块重渲染冲掉了。
        options.reading?.paintInto(card.body);
      }
      holder.append(card.root);
    }
  }

  host.replaceChildren(holder);
  return faces;
}

/** 真阵:按 layout 折格铺开;没几何的牌阵按原有的等宽格子排。 */
function renderSpread(
  doc: Document,
  cards: readonly TarotCardResult[],
  layout: SpreadLayout | null,
  options: { resolveAsset?: TarotAssetResolver; animate: boolean },
): { root: HTMLElement; faces: TarotFaceView[] } {
  const root = doc.createElement("div");
  const shaped = layout?.shaped === true;
  root.className = ["ad-spread", shaped ? SHAPED_SPREAD_CLASS : "", layout?.className ?? ""]
    .filter((name) => name !== "")
    .join(" ");
  if (layout?.cardWidth !== undefined) {
    root.style.setProperty("--ad-card-w", `${layout.cardWidth}px`);
  }

  const faces: TarotFaceView[] = [];
  const slots = spreadSlots(cards.length, layout);
  for (const slot of slots) {
    const item = doc.createElement("div");
    item.className = "ad-spread__item" + (slot.length > 1 ? " ad-spread__item--pile" : "");
    const area = slotArea(layout, slot);
    if (area !== null) item.dataset.area = area;

    const drawn = slot
      .map((index) => cards[index])
      .filter((card): card is TarotCardResult => card !== undefined);

    if (drawn.length > 1 && layout?.pile !== undefined) {
      // 叠牌:2 横压在 1 上,两张的牌位文字排在摞下面。
      const pile = createTarotPile(doc, drawn, {
        size: "md",
        resolveAsset: options.resolveAsset,
        animate: options.animate,
        crossingIndex: layout.pile.crossing,
      });
      faces.push(...pile.faces);
      item.append(pile.root);
      const captions = doc.createElement("div");
      captions.className = "ad-spread__pile-caps";
      for (const index of slot) {
        const entry = cards[index];
        if (entry === undefined) continue;
        captions.append(
          createTarotSlotReading(doc, entry, { index: index + 1, position: entry.position }),
        );
      }
      item.append(captions);
      root.append(item);
      continue;
    }

    const index = slot[0] ?? 0;
    const entry = cards[index];
    if (entry === undefined) continue;
    const face = createTarotFace(doc, entry, {
      size: "md",
      resolveAsset: options.resolveAsset,
      animate: options.animate,
    });
    faces.push(face);
    item.append(face.root);
    if (shaped) {
      item.append(
        createTarotSlotReading(doc, entry, { index: index + 1, position: entry.position }),
      );
      // 完整牌位与关键词收进 title:阵里格子窄,文字不该把阵压垮。
      item.title = [
        `${index + 1} ${entry.position}`,
        `${entry.card.nameChinese}${entry.orientation === "reversed" ? " 逆位" : " 正位"}`,
        tarotKeywords(entry).join(" · "),
      ].join(" · ");
    } else {
      item.append(createTarotReading(doc, entry, { position: entry.position, keywordLimit: 4 }));
    }
    root.append(item);
  }

  return { root, faces };
}

/** 塔罗:选牌阵、问事、可复现抽牌(同一 seed 结果稳定),结果按牌阵几何铺开。 */
export const tarotPanel: BusiPanel = {
  id: "tarot",
  label: "塔罗",
  render(host, storage, ctx) {
    const raw = storage as TarotStorage;
    const resolveAsset = ctx?.resolveAsset;
    const spreads = spreadOptions();
    const defaultSpread = spreads[0]?.value ?? "single";
    const spreadType = raw.spreadType ?? defaultSpread;
    const question = raw.question ?? "";
    const allowReversed = raw.allowReversed ?? true;

    host.replaceChildren();
    const form = host.ownerDocument.createElement("form");
    form.className = "ad-bp-form";
    form.addEventListener("submit", (event) => event.preventDefault());

    const questionField = createField(
      host,
      "问题(可选)",
      createTextField(host, "问题(可选)", question, "所问何事", true),
      true,
    );
    const spreadSelect = createSelectField(host, "牌阵", spreads, spreadType);
    const spreadField = createField(host, "牌阵", spreadSelect);
    const reversed = createCheckboxField(host, "允许逆位", allowReversed);
    /**
     * 抽牌种子在「点击那一刻」生成:毫秒时间戳 + 本次渲染内的递增序号。
     * 序号保证同一毫秒内连点两次也会得到不同的牌,而不是把上一次的结果再画一遍。
     */
    let drawSequence = 0;
    /** 翻牌用的计时器;面板被换掉时要收干净,不留悬空回调。 */
    const revealTimers: number[] = [];
    const clearRevealTimers = (): void => {
      for (const timer of revealTimers) window.clearTimeout(timer);
      revealTimers.length = 0;
    };

    const resultHost = host.ownerDocument.createElement("div");
    resultHost.className = "ad-bp-panel__result-host";

    // 解牌走共享的解卦槽:未配置给一行说明、请求中占位、失败给重试都在里面。
    const reading = createReadingSlot({
      host,
      storage: raw,
      ctx,
      label: "解牌",
      meta: () => readingMeta(raw),
      build: () => (raw.result === undefined ? null : readingRequestOf(raw.result)),
    });

    const submit = createSubmitButton(host, "抽牌", () => {
      const asked = form.querySelector<HTMLInputElement>('input[type="text"]')?.value ?? "";
      raw.question = asked;
      raw.spreadType = spreadSelect.value;
      raw.allowReversed = reversed.input.checked;
      raw.busy = true;
      raw.error = undefined;
      raw.result = undefined;
      // 上一副牌的解牌不跟着新牌走。
      raw.reading = undefined;
      clearRevealTimers();
      renderResult(resultHost, raw, { resolveAsset, animate: false, reading });
      drawSequence += 1;
      const input: TarotInput = {
        spreadType: spreadSelect.value,
        question: asked === "" ? undefined : asked,
        allowReversed: reversed.input.checked,
        seed: `${Date.now()}-${drawSequence}`,
      };
      const requests = requestTokenFor(raw);
      const token = requests.next();
      void calculateTarot(input)
        .then((output) => {
          // 连点两次抽牌时，先发起的那次不该再写回结果，也不该继续翻牌。
          if (!requests.isCurrent(token)) return;
          raw.result = output;
          raw.busy = false;
          // 先给牌背,再把正面翻出来;顺序在 revealTarotFaces 里错开。
          const faces = renderResult(resultHost, raw, {
            resolveAsset,
            animate: true,
            reading,
          });
          revealTimers.push(...revealTarotFaces(faces));
          reading.request();
        })
        .catch((error: unknown) => {
          if (!requests.isCurrent(token)) return;
          raw.error = collectError(error);
          raw.busy = false;
          renderResult(resultHost, raw, { resolveAsset, animate: false, reading });
        })
        .finally(() => {
          if (!requests.isCurrent(token)) return;
          ctx?.onSettled();
        });
    });

    form.append(questionField, spreadField, reversed.wrap, submit);
    host.append(form);
    host.append(resultHost);
    renderResult(resultHost, raw, { resolveAsset, animate: false, reading });

    return () => {
      clearRevealTimers();
      host.replaceChildren();
    };
  },
  harvest(host, storage) {
    const raw = storage as TarotStorage;
    const question = readInputValue(host, "问题(可选)");
    const spread = readInputValue(host, "牌阵");
    const reversed = readCheckboxValue(host, "允许逆位");
    if (question !== undefined) raw.question = question;
    if (spread !== undefined) raw.spreadType = spread;
    if (reversed !== undefined) raw.allowReversed = reversed;
  },
};
