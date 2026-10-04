import { calculateXiaoliurenData } from "taibu-core/xiaoliuren";
import type { XiaoliurenOutput } from "taibu-core/xiaoliuren";
import { Solar } from "lunar-javascript";
import type { BusiPanel } from "../../features/divination/bushiTypes";
import type { DivinationReadingFact } from "../../features/divination/divinationReading";
import { currentLunarYear, lunarMonthDayCount } from "../../features/divination/lunarMonth";
import { clockHourToShichen } from "../../features/divination/shichen";
import { createReadingSlot, type ReadingSlot, type ReadingSlotState } from "./readingSlot";
import { requestTokenFor } from "./panelToken";
import {
  collectError,
  createChip,
  createField,
  createNumberField,
  createPanelNotice,
  createResultCard,
  createSubmitButton,
  createTextField,
  readInputValue,
  readNumberValue,
} from "./bushiUi";

interface XiaoliurenStorage {
  lunarMonth?: number;
  lunarDay?: number;
  hour?: number;
  question?: string;
  result?: XiaoliurenOutput;
  error?: string;
  busy?: boolean;
  /** 解卦:跟着 result 走,重新起一课就重置。缓存在服务里,这里只存状态。 */
  reading?: ReadingSlotState;
}

/** 解卦请求:三宫与落宫就是这次起课的全部事实,标签即【逐条】要用的标签。 */
function readingRequestOf(storage: XiaoliurenStorage, result: XiaoliurenOutput) {
  const facts: DivinationReadingFact[] = [
    { label: "时宫(最终落宫)", value: `${result.hourStatus}（${result.result.name}）` },
    { label: "月宫(起因)", value: result.monthStatus },
    { label: "日宫(转折)", value: result.dayStatus },
    {
      label: "落宫详情",
      value: [
        `五行属${result.result.element}`,
        `方位${result.result.direction}`,
        `性质${result.result.nature ?? "平"}`,
      ].join(" · "),
    },
    { label: "断语诗", value: result.result.poem ?? "" },
  ];
  const shichen = result.input?.shichen ?? "";
  if (shichen !== "") facts.push({ label: "时辰", value: shichen });
  const asked = storage.question ?? "";
  return {
    kind: "method" as const,
    method: "xiaoliuren",
    // 三宫完全由农历月日时决定:同一课重渲染不重取,改一个数字才重算。
    // 键要涵盖全部输入：漏掉问事文本时，只改问题重起同一课会命中旧解卦。
    cacheKey: `${storage.lunarMonth ?? ""}|${storage.lunarDay ?? ""}|${storage.hour ?? ""}|${storage.question ?? ""}`,
    momentText: `${storage.lunarMonth ?? ""}月${storage.lunarDay ?? ""}日 ${shichen}`.trim(),
    question: asked,
    facts: facts.filter((fact) => fact.value !== ""),
  };
}

function renderResult(
  host: HTMLElement,
  storage: XiaoliurenStorage,
  reading?: ReadingSlot,
): void {
  const result = storage.result;
  const holder = host.ownerDocument.createElement("div");
  holder.className = "ad-bp-panel__result";
  if (storage.error !== undefined) {
    holder.append(createPanelNotice(host, "error", storage.error));
  } else if (result !== undefined) {
    const shichen = result.input?.shichen ?? "";
    const { monthStatus, dayStatus, hourStatus, result: final } = result;
    if (monthStatus === undefined || dayStatus === undefined || hourStatus === undefined) {
      holder.append(createPanelNotice(host, "error", "排课结果不完整"));
    } else {
      const card = createResultCard(host, final.name);
      const chips = host.ownerDocument.createElement("div");
      chips.className = "ad-bp-chips";
      chips.append(createChip(host, `月宫 · ${monthStatus}`));
      chips.append(createChip(host, `日宫 · ${dayStatus}`));
      chips.append(createChip(host, `时宫 · ${hourStatus}`, true, ));
      if (shichen !== "") chips.append(createChip(host, `时辰 · ${shichen}`));
      card.body.append(chips);

      const nature = host.ownerDocument.createElement("p");
      nature.className = "ad-bp-line";
      nature.textContent = [
        `五行属${final.element}`,
        `方位${final.direction}`,
        `性质${final.nature === undefined ? "平" : final.nature}`,
      ].join(" · ");
      card.body.append(nature);

      const description = host.ownerDocument.createElement("p");
      description.className = "ad-bp-line";
      description.textContent = final.description;
      card.body.append(description);

      if (final.poem !== undefined && final.poem !== "") {
        const poem = host.ownerDocument.createElement("p");
        poem.className = "ad-bp-poem";
        poem.textContent = final.poem;
        card.body.append(poem);
      }
      reading?.paintInto(card.body);
      holder.append(card.root);
    }
  }
  host.replaceChildren(holder);
}

/**
 * 小六壬:三个数字(农历月、日、时辰)定落宫。
 * 面板自带默认值填充(当天农历月日与当前时辰),用户可直接起课。
 */
/**
 * 今天的农历月日,用作表单默认值。
 * lunar-javascript 用负月份表示闰月,而小六壬的输入只接受 1–12,故取绝对值
 * (闰月落到同名月份,这是本域输入口径下的最优表达)。
 */
function currentLunarDate(now: Date): { month: number; day: number } {
  try {
    const lunar = Solar.fromDate(now).getLunar();
    return { month: Math.abs(lunar.getMonth()), day: lunar.getDay() };
  } catch {
    return { month: 1, day: 1 };
  }
}

/**
 * 字段名一处定义、渲染与 harvest 共用。
 *
 * harvest 是按 aria-label 反查输入框的（见 bushiUi.readInputValue/readNumberValue），
 * 名字原先在渲染与收割两处分别手写：写歪一处就会「静默读不到值」，不报错也不崩。
 */
const FIELDS = {
  month: "农历月",
  day: "农历日",
  hour: "时辰(0-23)",
  hourLabel: "时辰",
  question: "占问(可选)",
} as const;

export const xiaoliurenPanel: BusiPanel = {
  id: "xiaoliuren",
  label: "小六壬",
  render(host, storage, ctx) {
    const raw = storage as XiaoliurenStorage;
    const now = new Date();
    const defaults = currentLunarDate(now);
    const lunarYear = currentLunarYear(now);
    const month = raw.lunarMonth ?? defaults.month;
    const day = raw.lunarDay ?? defaults.day;
    const hour = raw.hour ?? now.getHours();
    const question = raw.question ?? "";

    host.replaceChildren();
    const form = host.ownerDocument.createElement("form");
    form.className = "ad-bp-form";
    form.addEventListener("submit", (event) => event.preventDefault());

    const monthInput = createNumberField(host, FIELDS.month, month, { min: 1, max: 12, width: "72px" });
    const dayInput = createNumberField(host, FIELDS.day, day, { min: 1, max: 30, width: "72px" });
    const hourInput = createNumberField(host, FIELDS.hour, hour, { min: 0, max: 23, width: "88px" });
    const questionInput = createTextField(host, FIELDS.question, question, "所问何事", true);
    const monthField = createField(host, FIELDS.month, monthInput);
    const dayField = createField(host, FIELDS.day, dayInput);
    const hourField = createField(host, FIELDS.hourLabel, hourInput);
    const questionField = createField(host, FIELDS.question, questionInput, true);

    const resultHost = host.ownerDocument.createElement("div");
    resultHost.className = "ad-bp-panel__result-host";
    const reading = createReadingSlot({
      host,
      storage: raw,
      ctx,
      build: () => (raw.result === undefined ? null : readingRequestOf(raw, raw.result)),
    });

    const submit = createSubmitButton(host, "起课", () => {
      const parsedMonth = Number(monthInput.value);
      const parsedDay = Number(dayInput.value);
      const parsedHour = Number(hourInput.value);
      const asked = questionInput.value;
      if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
        raw.error = "农历月取 1–12";
        raw.result = undefined;
        raw.reading = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 30) {
        raw.error = "农历日取 1–30";
        raw.result = undefined;
        raw.reading = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      // 农历月有 29/30 天两种;按当前农历年校验,避免「二月三十」这类不存在的日子照样起课。
      const dayLimit = lunarYear === null ? null : lunarMonthDayCount(lunarYear, parsedMonth);
      if (dayLimit !== null && parsedDay > dayLimit) {
        raw.error = `该农历月只有 ${dayLimit} 天`;
        raw.result = undefined;
        raw.reading = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      if (!Number.isInteger(parsedHour) || parsedHour < 0 || parsedHour > 23) {
        raw.error = "时辰取 0–23 时";
        raw.result = undefined;
        raw.reading = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      raw.lunarMonth = parsedMonth;
      raw.lunarDay = parsedDay;
      raw.hour = parsedHour;
      raw.question = asked;
      raw.busy = true;
      raw.error = undefined;
      raw.result = undefined;
      // 上一课的解卦不跟着新课走。
      raw.reading = undefined;
      renderResult(resultHost, raw, reading);
      const requests = requestTokenFor(raw);
      const token = requests.next();
      void (async () => {
        try {
          const output = await Promise.resolve(calculateXiaoliurenData({
            lunarMonth: parsedMonth,
            lunarDay: parsedDay,
            // 库对 1–12 按「时辰序号」解释,这里必须把 0–23 时钟小时换算过去。
            hour: clockHourToShichen(parsedHour),
            question: asked === "" ? undefined : asked,
          }));
          // 连点两次起课时，先发起的那次结果不许再写回。
          if (!requests.isCurrent(token)) return;
          raw.result = output;
          raw.busy = false;
          renderResult(resultHost, raw, reading);
          reading.request();
        } catch (error: unknown) {
          if (!requests.isCurrent(token)) return;
          raw.error = collectError(error);
          raw.busy = false;
          renderResult(resultHost, raw, reading);
        }
        ctx?.onSettled();
      })();
    });

    form.append(monthField, dayField, hourField, questionField, submit);
    host.append(form);
    host.append(resultHost);
    renderResult(resultHost, raw, reading);

    const cleanup = (): void => {
      host.replaceChildren();
    };
    return cleanup;
  },
  harvest(host, storage) {
    const raw = storage as XiaoliurenStorage;
    const month = readNumberValue(host, FIELDS.month);
    const day = readNumberValue(host, FIELDS.day);
    const hour = readNumberValue(host, FIELDS.hour);
    const question = readInputValue(host, FIELDS.question);
    if (month !== undefined) raw.lunarMonth = month;
    if (day !== undefined) raw.lunarDay = day;
    if (hour !== undefined) raw.hour = hour;
    if (question !== undefined) raw.question = question;
  },
};
