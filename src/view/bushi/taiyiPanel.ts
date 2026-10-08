import { calculateTaiyi } from "taibu-core/taiyi";
import type { TaiyiInput, TaiyiOutput } from "taibu-core/taiyi";
import type { BusiPanel } from "../../features/divination/bushiTypes";
import type { DivinationReadingFact } from "../../features/divination/divinationReading";
import { createReadingSlot, type ReadingSlot, type ReadingSlotState } from "./readingSlot";
import { requestTokenFor } from "./panelToken";
import {
  collectError,
  createChip,
  createField,
  createPanelNotice,
  createResultCard,
  createSegmented,
  createSubmitButton,
  createTextField,
  nowLocalInputValue,
  readInputValue,
  readSegmentedValue,
  systemTimeZone,
  toCoreDateTime,
  type SelectOption,
} from "./bushiUi";

interface TaiyiStorage {
  mode?: string;
  dateValue?: string;
  question?: string;
  result?: TaiyiOutput;
  error?: string;
  /** 解卦:跟着 result 走,重新起局就重置。缓存在服务里,这里只存状态。 */
  reading?: ReadingSlotState;
}

/** 解卦请求:太乙看「势」——盘元、时空底盘、主星与吉凶信号就够了,宫格里逐宫细目不进提示词。 */
function readingFactsOf(result: TaiyiOutput): DivinationReadingFact[] {
  const facts: DivinationReadingFact[] = [];
  const { boardMeta, datetimeContext, coreBoard, derivedIndicators, judgementAnchors } = result;
  facts.push({
    label: "盘元",
    value: [boardMeta.systemLabel, boardMeta.modeLabel, boardMeta.minuteSlot ?? ""]
      .filter((part) => part !== "")
      .join(" · "),
  });
  facts.push({
    label: "时空底盘",
    value: [
      `${datetimeContext.solarDateTime}`,
      datetimeContext.lunarDate,
      datetimeContext.jieQi ?? "",
      `${datetimeContext.yearGanZhi}年 ${datetimeContext.monthGanZhi}月 ${datetimeContext.dayGanZhi}日 ${datetimeContext.hourGanZhi}时`,
      `${datetimeContext.xiu}宿（${datetimeContext.xiuLuck}）`,
      `值日${datetimeContext.dayOfficer}`,
      `天神${datetimeContext.tianShen}（${datetimeContext.tianShenLuck}）`,
    ].filter((part) => part !== "").join(" · "),
  });
  const star = (name: string, snapshot: TaiyiOutput["coreBoard"]["primaryStar"] | undefined): void => {
    if (snapshot === undefined) return;
    facts.push({
      label: name,
      value: [
        `${snapshot.taiyiName}（${snapshot.taiyiType}）`,
        `落${snapshot.position}宫 · ${snapshot.positionDesc}`,
        `五行${snapshot.wuXing} · 数${snapshot.number} · ${snapshot.scaleLabel}`,
        snapshot.qimenGate === undefined ? "" : `奇门${snapshot.qimenGate}（${snapshot.qimenLuck}）`,
      ].filter((part) => part !== "").join(" · "),
    });
  };
  star("主星", coreBoard.primaryStar);
  star("时星", coreBoard.hourStar);
  star("日星", coreBoard.dayStar);
  if (derivedIndicators.favorableSignals.length > 0) {
    facts.push({ label: "吉征", value: derivedIndicators.favorableSignals.join("；") });
  }
  if (derivedIndicators.cautionSignals.length > 0) {
    facts.push({ label: "凶征", value: derivedIndicators.cautionSignals.join("；") });
  }
  facts.push({
    label: "能量与方位",
    value: `${derivedIndicators.elementRelation} · 方位${derivedIndicators.directionalHint}`,
  });
  if (judgementAnchors.summary.length > 0) {
    facts.push({ label: "断事摘要", value: judgementAnchors.summary.join("；") });
  }
  return facts;
}

const MODES: SelectOption[] = [
  { value: "hour", label: "时家" },
  { value: "day", label: "日家" },
  { value: "month", label: "月家" },
  { value: "year", label: "年家" },
  { value: "minute", label: "分家" },
];

type StarSnapshot = NonNullable<NonNullable<TaiyiOutput["coreBoard"]>["primaryStar"]>;

/** 洛书九宫排布(九星家常用布局):巽4 离9 坤2 / 震3 中5 兑7 / 艮8 坎1 乾6。 */
const LUOSHU_CELLS: ReadonlyArray<{ gua: string; direction: string }> = [
  { gua: "巽", direction: "东南" }, { gua: "离", direction: "正南" }, { gua: "坤", direction: "西南" },
  { gua: "震", direction: "正东" }, { gua: "中", direction: "中央" }, { gua: "兑", direction: "正西" },
  { gua: "艮", direction: "东北" }, { gua: "坎", direction: "正北" }, { gua: "乾", direction: "西北" },
];

/**
 * 九宫盘:把主星与年/月/日/时星按 position 落宫画出来。
 * 主星就是当前尺度那一颗,与同尺度的星去重,避免同一宫重复展示。
 */
function renderPalaceGrid(
  host: HTMLElement,
  board: NonNullable<TaiyiOutput["coreBoard"]>,
): HTMLElement | null {
  const doc = host.ownerDocument;
  const primary = board.primaryStar;
  const others = [board.yearStar, board.monthStar, board.dayStar, board.hourStar]
    .filter((star): star is StarSnapshot => star !== undefined)
    .filter((star) => star.scale !== primary?.scale);
  const stars: StarSnapshot[] = primary === undefined ? others : [primary, ...others];
  if (stars.length === 0) return null;

  const grid = doc.createElement("div");
  grid.className = "ad-ty-palace-grid";
  for (const cell of LUOSHU_CELLS) {
    const cellElement = doc.createElement("div");
    cellElement.className = cell.gua === "中" ? "ad-ty-palace ad-ty-palace--center" : "ad-ty-palace";
    cellElement.dataset.gua = cell.gua;

    const head = doc.createElement("div");
    head.className = "ad-ty-palace__head";
    const name = doc.createElement("span");
    name.textContent = cell.gua;
    const direction = doc.createElement("span");
    direction.textContent = cell.direction;
    head.append(name, direction);
    cellElement.append(head);

    for (const star of stars) {
      if (star.position !== cell.gua) continue;
      const line = doc.createElement("span");
      line.className = "ad-ty-palace__star";
      line.textContent = star.taiyiName;
      const meta = doc.createElement("small");
      meta.textContent = ` ${star.scaleLabel}${star.number} · ${star.wuXing} · ${star.taiyiType}`;
      line.append(meta);
      cellElement.append(line);
    }
    grid.append(cellElement);
  }
  return grid;
}

function renderStarCard(host: HTMLElement, star: StarSnapshot | undefined, primary: boolean): HTMLElement {
  const doc = host.ownerDocument;
  const card = doc.createElement("div");
  card.className = primary ? "ad-ty-star ad-ty-star--primary" : "ad-ty-star";
  if (star === undefined) return card;
  const scale = doc.createElement("span");
  scale.className = "ad-ty-star__scale";
  scale.textContent = star.scaleLabel;
  const number = doc.createElement("strong");
  number.className = "ad-ty-star__number";
  number.textContent = String(star.number);
  const position = doc.createElement("span");
  position.className = "ad-ty-star__position";
  position.textContent = `${star.position}（${star.positionDesc}）`;
  card.append(scale, number, position);
  const detail = doc.createElement("div");
  detail.className = "ad-ty-star__detail";
  // 中宫那颗星(天禽)没有门:库里 qimenGate 是 undefined(实测 336 局里 110 局中宫有星,
  // 每次都缺门)。直接拼进模板会印出「奇门天禽 undefined」,看着像坏了。
  const qimenText = [`奇门${star.qimenName}`, star.qimenGate ?? ""]
    .filter((part) => part !== "")
    .join(" ");
  detail.append(
    createChip(host, `${star.beidouName}`),
    createChip(host, `玄空${star.xuankongName}`),
    createChip(host, qimenText),
  );
  const line = doc.createElement("p");
  line.className = "ad-ty-star__line";
  line.textContent = `${star.color}·${star.wuXing} · ${star.taiyiName}（${star.taiyiType}） · 奇门${star.qimenLuck}`;
  card.append(detail, line);
  return card;
}

function renderResult(host: HTMLElement, storage: TaiyiStorage, reading?: ReadingSlot): void {
  const doc = host.ownerDocument;
  const holder = doc.createElement("div");
  holder.className = "ad-bp-panel__result";
  if (storage.error !== undefined) {
    holder.append(createPanelNotice(host, "error", storage.error));
    host.replaceChildren(holder);
    return;
  }
  const output = storage.result;
  if (output === undefined) {
    host.replaceChildren(holder);
    return;
  }

  const meta = output.boardMeta;
  const card = createResultCard(host, `${meta?.systemLabel ?? "太乙"} · ${meta?.modeLabel ?? ""}`);
  const body = card.body;

  const context = output.datetimeContext;
  if (context !== undefined) {
    const line = doc.createElement("p");
    line.className = "ad-ty-context";
    line.textContent = [
      context.solarDateTime,
      context.lunarDate,
      `${context.yearGanZhi}年 ${context.monthGanZhi}月 ${context.dayGanZhi}日 ${context.hourGanZhi}时`,
      `宿${context.xiu}（${context.xiuLuck}）`,
      `值${context.dayOfficer}`,
      `天神${context.tianShen}（${context.tianShenLuck}）`,
    ].filter((part) => part !== "" && part !== undefined).join(" · ");
    body.append(line);
  }

  const board = output.coreBoard;
  if (board !== undefined) {
    const stars = doc.createElement("div");
    stars.className = "ad-ty-board";
    stars.append(renderStarCard(host, board.primaryStar, true));
    const others = doc.createElement("div");
    others.className = "ad-ty-board__others";
    for (const star of [board.yearStar, board.monthStar, board.dayStar, board.hourStar]) {
      others.append(renderStarCard(host, star, false));
    }
    stars.append(others);
    body.append(stars);
    const palaceGrid = renderPalaceGrid(host, board);
    if (palaceGrid !== null) {
      body.append(palaceGrid);
      // 实测每局只有 3–4 个宫有星落位(336 局里空 5–6 宫是常态):
      // 空格子不说一句,读者会以为盘没画完。
      const palaceNote = doc.createElement("p");
      palaceNote.className = "ad-ly-line ad-ly-line--muted";
      palaceNote.textContent = "九星只落数宫，其余宫位留空为常态。";
      body.append(palaceNote);
    }
  }

  const anchors = output.judgementAnchors;
  if (anchors !== undefined) {
    if (anchors.primarySong !== undefined && anchors.primarySong !== "") {
      const song = doc.createElement("p");
      song.className = "ad-bp-poem";
      song.textContent = anchors.primarySong;
      body.append(song);
    }
    if (anchors.summary.length > 0) {
      const list = doc.createElement("ul");
      list.className = "ad-ty-anchors";
      for (const item of anchors.summary) {
        const entry = doc.createElement("li");
        entry.textContent = item;
        list.append(entry);
      }
      body.append(list);
    }
  }

  const indicators = output.derivedIndicators;
  if (indicators !== undefined) {
    if (indicators.favorableSignals.length > 0) {
      const good = doc.createElement("div");
      good.className = "ad-bp-chips";
      for (const item of indicators.favorableSignals) good.append(createChip(host, item, true));
      body.append(good);
    }
    if (indicators.cautionSignals.length > 0) {
      const bad = doc.createElement("div");
      bad.className = "ad-bp-chips";
      for (const item of indicators.cautionSignals) {
        const chip = createChip(host, item);
        chip.classList.add("ad-bp-chip--warn");
        bad.append(chip);
      }
      body.append(bad);
    }
    const relation = doc.createElement("p");
    relation.className = "ad-ly-line ad-ly-line--muted";
    relation.textContent = `${indicators.elementRelation} · 方位 ${indicators.directionalHint}`;
    body.append(relation);
  }

  reading?.paintInto(card.body);
  holder.append(card.root);
  host.replaceChildren(holder);
}

/** 太乙:五档尺度(时/日/月/年/分)起局,主星大卡 + 四盘小卡 + 断事锚点。 */
export const taiyiPanel: BusiPanel = {
  id: "taiyi",
  label: "太乙",
  render(host, storage, ctx) {
    const raw = storage as TaiyiStorage;
    const now = new Date();
    host.replaceChildren();
    const doc = host.ownerDocument;
    const form = doc.createElement("form");
    form.className = "ad-bp-form";
    form.addEventListener("submit", (event) => event.preventDefault());

    const dateInput = doc.createElement("input");
    dateInput.type = "datetime-local";
    dateInput.value = raw.dateValue ?? nowLocalInputValue(now);
    dateInput.className = "ad-bp-input";
    dateInput.setAttribute("aria-label", "起局时间");
    const questionInput = createTextField(host, "占问(可选)", raw.question ?? "", "所问何事", true);

    const modeSegmented = createSegmented(
      host,
      MODES,
      raw.mode ?? "hour",
      (value) => { raw.mode = value; },
      "太乙家",
    );

    const resultHost = doc.createElement("div");
    resultHost.className = "ad-bp-panel__result-host";
    const reading = createReadingSlot({
      host,
      storage: raw,
      ctx,
      build: () => (raw.result === undefined ? null : {
        kind: "method" as const,
        method: "taiyi",
        // 日/月/年家不传时刻,同一天同一盘:键也跟着只到日粒度(dateValue 是
        // datetime-local,不截断的话同一天改分钟会重复取解卦)。问事文本也要进键。
        cacheKey: `${raw.mode ?? "hour"}|${(raw.mode ?? "hour") === "hour" ? raw.dateValue ?? "" : (raw.dateValue ?? "").slice(0, 10)}|${systemTimeZone()}|${raw.question ?? ""}`,
        momentText: raw.dateValue ?? "",
        question: raw.question ?? "",
        facts: readingFactsOf(raw.result),
      }),
    });

    const submit = createSubmitButton(host, "起局", () => {
      raw.dateValue = dateInput.value;
      raw.question = questionInput.value;
      const coreDate = toCoreDateTime(dateInput.value);
      if (coreDate === null) {
        raw.error = "起局时间不合法";
        raw.result = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      raw.error = undefined;
      raw.result = undefined;
      // 上一局的解卦不跟着新局走。
      raw.reading = undefined;
      renderResult(resultHost, raw, reading);
      const [date, time] = coreDate.split("T");
      if (date === undefined || time === undefined) {
        raw.error = "起局时间不合法";
        renderResult(resultHost, raw, reading);
        return;
      }
      const mode = (raw.mode ?? "hour") as TaiyiInput["mode"];
      // 与大六壬面板同口径:起局时间按本机 IANA 时区解释(库的默认值是 Asia/Shanghai)。
      const input: TaiyiInput = { mode, date, timezone: systemTimeZone() };
      if (mode === "hour" || mode === "minute") {
        input.hour = Number(time.slice(0, 2));
        input.minute = Number(time.slice(3, 5));
      }
      if (raw.question !== "") input.question = raw.question;
      const requests = requestTokenFor(raw);
      const token = requests.next();
      void (async () => {
        try {
          const output = await Promise.resolve(calculateTaiyi(input));
          // 连点两次起局时，先发起的那次结果不许再写回。
          if (!requests.isCurrent(token)) return;
          raw.result = output;
          renderResult(resultHost, raw, reading);
          reading.request();
        } catch (error: unknown) {
          if (!requests.isCurrent(token)) return;
          raw.error = collectError(error);
          renderResult(resultHost, raw, reading);
        }
        ctx?.onSettled();
      })();
    });

    form.append(
      createField(host, "太乙家", modeSegmented.root),
      createField(host, "起局时间", dateInput),
      createField(host, "占问(可选)", questionInput, true),
      submit,
    );
    host.append(form);
    host.append(resultHost);
    renderResult(resultHost, raw, reading);

    return () => {
      modeSegmented.cleanup();
      host.replaceChildren();
    };
  },
  harvest(host, storage) {
    const raw = storage as TaiyiStorage;
    const mode = readSegmentedValue(host, "太乙家");
    const dateValue = readInputValue(host, "起局时间");
    const question = readInputValue(host, "占问(可选)");
    if (mode !== undefined) raw.mode = mode;
    if (dateValue !== undefined) raw.dateValue = dateValue;
    if (question !== undefined) raw.question = question;
  },
};
