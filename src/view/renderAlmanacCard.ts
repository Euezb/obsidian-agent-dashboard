import type { AlmanacCard } from "../features/divination/almanacCard";

/**
 * 头部黄历卡:位于「今天从这里开始」问候语的右方。
 * 只读展示,没有任何事件监听;日期跨天后由 view 重新计算并整页重渲染。
 */
export function createAlmanacCard(
  doc: Document,
  card: AlmanacCard,
): HTMLElement {
  const root = doc.createElement("aside");
  root.className = "ad-almanac";

  const eyebrow = doc.createElement("div");
  eyebrow.className = "ad-almanac__eyebrow";
  const eyebrowLabel = doc.createElement("span");
  eyebrowLabel.textContent = "今日黄历";
  const eyebrowDate = doc.createElement("span");
  eyebrowDate.textContent = card.solarText;
  eyebrow.append(eyebrowLabel, eyebrowDate);

  const ganZhi = doc.createElement("div");
  ganZhi.className = "ad-almanac__gz";
  ganZhi.textContent = card.ganZhi;

  const lunar = doc.createElement("div");
  lunar.className = "ad-almanac__lunar";
  lunar.textContent = [
    `农历${card.lunarText}`,
    card.zodiac === "" ? "" : `肖${card.zodiac}`,
    card.tianShen,
  ].filter((part) => part !== "").join(" · ");

  root.append(eyebrow, ganZhi, lunar);

  if (card.yi.length > 0 || card.ji.length > 0) {
    const rows = doc.createElement("div");
    rows.className = "ad-almanac__rows";

    const yi = doc.createElement("div");
    yi.className = "ad-almanac__row";
    const yiLabel = doc.createElement("span");
    yiLabel.className = "ad-almanac__label ad-almanac__label--yi";
    yiLabel.textContent = "宜";
    yi.append(yiLabel, doc.createTextNode(card.yi.join(" · ")));

    const ji = doc.createElement("div");
    ji.className = "ad-almanac__row";
    const jiLabel = doc.createElement("span");
    jiLabel.className = "ad-almanac__label ad-almanac__label--ji";
    jiLabel.textContent = "忌";
    ji.append(jiLabel, doc.createTextNode(card.ji.join(" · ")));

    rows.append(yi, ji);
    root.append(rows);
  }

  if (card.chongSha !== "" || card.directions !== "" || card.meta !== "") {
    const meta = doc.createElement("div");
    meta.className = "ad-almanac__meta";
    meta.textContent = [card.chongSha, card.directions, card.meta]
      .filter((part) => part !== "")
      .join(" · ");
    root.append(meta);
  }

  return root;
}
