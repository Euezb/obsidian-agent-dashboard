import { createElement } from "./domHelpers";

/**
 * 解卦块(「题签」版式):朱砂竖签 + 横排正文。
 *
 * 九个卜筮面板与「今日一牌」共用同一个组件 —— 都是大模型读同一类东西,
 * 版式不该每种术数长得不一样。今日一牌那边用 inline(收在牌右侧那一栏里),
 * 卜筮面板用通栏(排在结果下方)。
 *
 * 版面只认状态,不认网络:请求、缓存、失败重试都在外面,这里只负责画。
 */

export type DivinationReadingStatus = "idle" | "loading" | "ready" | "error" | "off";

export interface DivinationReadingViewState {
  status: DivinationReadingStatus;
  /** ready:正文。段落之间空一行,【标题】独占一行。 */
  text?: string;
  /** loading / error / off 时的一行说明。 */
  message?: string;
  /** 口径小字,例如「glm-5.3-flash · 10:28 生成」。 */
  meta?: string;
  onRetry?: () => void;
}

export interface DivinationReadingNoteOptions {
  /** true 时收进读牌那一栏(今日一牌的红框);false 走通栏(卜筮结果下方)。 */
  inline?: boolean;
  /** 竖签上的两个字:塔罗用「解牌」,其余术数用「解卦」。 */
  label?: string;
}

/** 解卦块的状态钩子:正文、竖签与失败重试都挂在这一层上。 */
export const DIVINATION_READING_NOTE_CLASS = "ad-note";

const DEFAULT_LABEL = "解卦";

function paragraph(doc: Document, text: string): HTMLElement {
  const line = doc.createElement("p");
  line.textContent = text;
  return line;
}

/** 【逐张】(塔罗)与【逐条】(其余术数)下面才是「标签：正文」的行。 */
function isRowSection(title: string): boolean {
  return title.includes("逐张") || title.includes("逐条");
}

/**
 * 把解卦正文拆成标题 / 逐条行 / 段落。
 *
 * 模型按提示词输出的是【总断】【逐条】【可行】三段:
 * 方括号标题独占一行,标题下面每行是「标签：正文」。
 * 只有在逐条段里才把「xx：yy」当行排,免得正文里一个冒号就被拆成表格。
 */
function appendReadingBody(doc: Document, body: HTMLElement, text: string): void {
  let inRows = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const heading = /^【([^】]+)】\s*(.*)$/.exec(line);
    if (heading !== null) {
      const section = doc.createElement("p");
      section.className = "ad-note__section";
      section.textContent = `【${heading[1] ?? ""}】`;
      body.append(section);
      inRows = isRowSection(heading[1] ?? "");
      // 提示词要求标题独占一行,但模型偶尔会写成「【总断】正文…」,照读不误。
      const rest = heading[2] ?? "";
      if (rest !== "") body.append(paragraph(doc, rest));
      continue;
    }
    const row = inRows ? /^(\d+)?[.、]?\s*([^\s：:]{1,14})[：:]\s*(.+)$/.exec(line) : null;
    if (row !== null) {
      const rows = doc.createElement("div");
      rows.className = "ad-note__rows";
      const index = doc.createElement("span");
      index.className = "ad-note__rows-index";
      index.textContent = row[1] ?? "";
      const label = doc.createElement("span");
      label.className = "ad-note__rows-label";
      label.textContent = row[2] ?? "";
      const value = doc.createElement("span");
      value.className = "ad-note__rows-text";
      value.textContent = row[3] ?? "";
      rows.append(index, label, value);
      body.append(rows);
      continue;
    }
    // 失配的一行只让「本行」退化成段落，不能顺手把整个 section 的逐条状态关掉：
    // 否则一行标签超长或带空格，它后面所有行都会跟着变成段落。
    // inRows 只由标题行切换（见上面的 heading 分支）。
    body.append(paragraph(doc, line));
  }
}

function appendFoot(
  doc: Document,
  body: HTMLElement,
  state: DivinationReadingViewState,
  label: string,
): void {
  if (state.meta === undefined && state.onRetry === undefined) return;
  const foot = doc.createElement("p");
  foot.className = "ad-note__foot";
  if (state.meta !== undefined && state.meta !== "") {
    const meta = doc.createElement("span");
    meta.textContent = state.meta;
    foot.append(meta);
  }
  if (state.onRetry !== undefined) {
    const retry = state.onRetry;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "ad-inline-action";
    button.textContent = state.status === "error" ? "重试" : `重新${label}`;
    button.addEventListener("click", retry);
    foot.append(button);
  }
  body.append(foot);
}

/**
 * 画一块解卦。返回根节点;`idle`(宿主没给解卦能力)时返回 null,调用方据此整块不渲染。
 */
export function renderDivinationReadingNote(
  host: HTMLElement,
  state: DivinationReadingViewState,
  options: DivinationReadingNoteOptions = {},
): HTMLElement | null {
  if (state.status === "idle") return null;
  const label = options.label ?? DEFAULT_LABEL;
  const doc = host.ownerDocument;
  const note = createElement(host, "div");
  note.className = DIVINATION_READING_NOTE_CLASS +
    (options.inline === true ? " ad-note--inline" : "");
  note.dataset.status = state.status;

  const tab = createElement(host, "span");
  tab.className = "ad-note__tab";
  tab.textContent = label;
  note.append(tab);

  const body = createElement(host, "div");
  body.className = "ad-note__body";
  note.append(body);

  if (state.status === "ready") {
    appendReadingBody(doc, body, state.text ?? "");
    appendFoot(doc, body, state, label);
  } else {
    const pending = createElement(host, "p");
    pending.className = "ad-note__pending";
    pending.setAttribute("role", "status");
    pending.textContent = state.message ??
      (state.status === "loading" ? `正在${label}…` : `${label}暂不可用。`);
    body.append(pending);
    if (state.status === "error") appendFoot(doc, body, state, label);
  }

  host.append(note);
  return note;
}
