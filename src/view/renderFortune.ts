import {
  palmSteps,
  type DailyFortune,
} from "../features/divination/dailyFortune";
import type { TarotAssetResolver } from "../features/divination/tarotFace";
import { createElement } from "./domHelpers";
import { createTarotFace, createTarotReading } from "./renderTarotFace";
import { renderDivinationReadingNote, type DivinationReadingViewState } from "./renderDivinationReading";
import { renderSectionHead } from "./renderSectionHead";

/**
 * 「今日运势」板块:左边每天一张的塔罗单抽,右边小六壬今日时课。
 *
 * 两个面板都是纯展示,没有任何输入与事件监听 —— 牌与课在插件打开时算好,
 * 跨天/跨时辰由 view 重新计算后整块重渲染(与黄历卡同一个节奏)。
 * 右侧那条掌诀按起课顺序排开六宫,月/日/时三步落在哪一格看得见,
 * 而不是只丢一个落宫名出来。
 *
 * 今日一牌右侧那一栏放不下牌面以外的信息,所以大模型解牌写在那里(题签),
 * 由 view 取回、这里只负责画;页脚的口径也跟着改 —— 牌是本地算的,解牌不是。
 */

export interface FortuneRenderOptions {
  /** 素材地址解析;缺省时牌面降级成占位牌(版面尺寸不变)。 */
  resolveAsset?: TarotAssetResolver;
  /** 今日一牌的大模型解牌;缺省或 idle 时这一块不出现。 */
  reading?: DivinationReadingViewState;
}

function renderPanelHeading(
  container: HTMLElement,
  title: string,
  meta: string,
): void {
  const heading = createElement(container, "div");
  heading.className = "ad-panel-heading";
  const titleElement = createElement(container, "h3");
  titleElement.textContent = title;
  const toolbar = createElement(container, "div");
  toolbar.className = "ad-panel-toolbar";
  const metaElement = createElement(container, "span");
  metaElement.textContent = meta;
  toolbar.append(metaElement);
  heading.append(titleElement, toolbar);
  container.append(heading);
}

/** 掌诀走位:六宫一排,被踩到的宫位标出月/日/时,时宫填朱砂。 */
function renderPalmStrip(container: HTMLElement, fortune: DailyFortune): void {
  const xiaoliuren = fortune.xiaoliuren;
  const strip = createElement(container, "div");
  strip.className = "ad-palm";
  strip.setAttribute("role", "img");
  strip.setAttribute(
    "aria-label",
    `小六壬掌诀:月落${xiaoliuren.monthStatus},日落${xiaoliuren.dayStatus},时落${xiaoliuren.hourStatus}`,
  );

  for (const step of palmSteps(xiaoliuren)) {
    const cell = createElement(container, "div");
    cell.className = "ad-palm__cell";
    cell.dataset.hit = String(step.tokens.length > 0);
    if (step.tokens.length > 0) {
      cell.title = `${step.palace} · ${step.tokens.join("")}宫`;
    }
    const name = createElement(container, "span");
    name.className = "ad-palm__name";
    name.textContent = step.palace;
    const tokenRow = createElement(container, "div");
    tokenRow.className = "ad-palm__tokens";
    for (const token of step.tokens) {
      const tokenElement = createElement(container, "span");
      tokenElement.className =
        token === "时" ? "ad-palm__token ad-palm__token--hour" : "ad-palm__token";
      tokenElement.textContent = token;
      tokenRow.append(tokenElement);
    }
    cell.append(name, tokenRow);
    strip.append(cell);
  }
  container.append(strip);

  const legend = createElement(container, "div");
  legend.className = "ad-palm__legend";
  legend.append(container.ownerDocument.createTextNode("月 → 日 → 时 三步走宫，"));
  const final = createElement(container, "b");
  final.textContent = "时宫";
  legend.append(final, container.ownerDocument.createTextNode("为最终落宫"));
  container.append(legend);
}

function renderTarotPanel(
  container: HTMLElement,
  fortune: DailyFortune,
  options: FortuneRenderOptions,
): void {
  const panel = createElement(container, "div");
  panel.className = "ad-fortune__tarot";
  renderPanelHeading(panel, "今日一牌", `单牌 · ${fortune.dateKey}`);

  const deal = createElement(container, "div");
  deal.className = "ad-fortune__deal";

  const doc = container.ownerDocument;
  deal.append(
    createTarotFace(doc, fortune.tarot, {
      size: "xl",
      resolveAsset: options.resolveAsset,
    }).root,
  );

  const element = fortune.tarot.element;
  const reading = createTarotReading(doc, fortune.tarot, {
    position: "今日一牌 · 单牌阵",
    meta: [element === undefined ? "" : `元素${element}`, "每日 0 点换牌"]
      .filter((part) => part !== "")
      .join(" · "),
  });
  // 解牌收在读牌那一栏里(牌右侧那片空白):牌面立着,批注贴着它。
  if (options.reading !== undefined) {
    renderDivinationReadingNote(reading, options.reading, { inline: true, label: "解牌" });
  }
  deal.append(reading);

  panel.append(deal);
  container.append(panel);
}

function renderXiaoliurenPanel(container: HTMLElement, fortune: DailyFortune): void {
  const panel = createElement(container, "div");
  panel.className = "ad-fortune__xlr";
  renderPanelHeading(panel, "今日课", `小六壬 · ${fortune.shichen}时课`);

  const result = fortune.xiaoliuren.result;
  const palace = createElement(container, "p");
  palace.className = "ad-fortune__palace";
  const palaceName = createElement(container, "span");
  palaceName.className = "ad-fortune__palace-name";
  palaceName.textContent = result.name;
  const palaceMeta = createElement(container, "span");
  palaceMeta.className = "ad-fortune__palace-meta";
  palaceMeta.textContent = [
    `五行属${result.element}`,
    `方位${result.direction}`,
    `性质${result.nature === undefined ? "平" : result.nature}`,
  ].join(" · ");
  palace.append(palaceName, palaceMeta);
  panel.append(palace);

  renderPalmStrip(panel, fortune);

  const description = createElement(container, "p");
  description.className = "ad-fortune__line";
  description.textContent = result.description;
  panel.append(description);

  if (result.poem !== undefined && result.poem !== "") {
    const poem = createElement(container, "p");
    poem.className = "ad-fortune__poem";
    poem.textContent = result.poem;
    panel.append(poem);
  }

  container.append(panel);
}

export function renderFortune(
  container: HTMLElement,
  fortune: DailyFortune,
  options: FortuneRenderOptions = {},
): () => void {
  container.replaceChildren();
  container.className = "ad-section ad-fortune";
  container.dataset.region = "fortune";

  // 批注写这个板块的口径:一天一牌、一课。
  renderSectionHead(container, "今日运势", { meta: "每日一占" });

  const grid = createElement(container, "div");
  grid.className = "ad-fortune__grid";
  renderTarotPanel(grid, fortune, options);
  renderXiaoliurenPanel(grid, fortune);
  container.append(grid);

  const xiaoliuren = fortune.xiaoliuren;
  const foot = createElement(container, "p");
  foot.className = "ad-fortune__foot";
  foot.textContent = [
    fortune.lunarText,
    `${fortune.shichen}时课`,
    `月宫${xiaoliuren.monthStatus} · 日宫${xiaoliuren.dayStatus} · 时宫${xiaoliuren.hourStatus}`,
    // 口径要跟事实一致:牌与课是本地算的,解牌不是。
    options.reading === undefined || options.reading.status === "idle"
      ? "本地计算，不联网"
      : "本地起课 · 解牌由大模型生成（可在设置里关）",
  ]
    .filter((part) => part !== "")
    .join(" · ");
  container.append(foot);

  return () => {
    container.replaceChildren();
  };
}
