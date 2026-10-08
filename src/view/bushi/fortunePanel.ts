import { calculateBazi, calculateBaziLiuRiData, calculateBaziLiuYueData } from "taibu-core/bazi";
import { calculateDailyAlmanac } from "taibu-core/almanac";
import type { AlmanacOutput } from "taibu-core/almanac";
import type { BaziInput } from "taibu-core/bazi";
import type { BusiPanel } from "../../features/divination/bushiTypes";
import { elementRelationNote, tenGodOf } from "../../features/divination/ganzhi";
import { findLiuYue, liuYueReferenceDate } from "../../features/divination/liuyue";
import type { DivinationReadingFact, DivinationReadingRequest } from "../../features/divination/divinationReading";
import { createReadingSlot, type ReadingSlot, type ReadingSlotState } from "./readingSlot";
import { requestTokenFor } from "./panelToken";
import { localDateKey } from "../../domain/localDate";
import {
  collectError,
  createChip,
  createField,
  createPanelNotice,
  createResultCard,
  createSegmented,
  createSubmitButton,
  readInputValue,
  readSegmentedValue,
} from "./bushiUi";

/** 流月摘要:干支取自 taibu-core 的流月表(节气月柱),不是当月首日的日干支。 */
interface MonthSummary {
  ganZhi: string;
  tenGod: string;
  jieQi: string;
  startDate: string;
  endDate: string;
  naYin: string;
  diShi: string;
}

interface FortuneStorage {
  birthDate?: string;
  birthTime?: string;
  gender?: "male" | "female";
  dayMaster?: string;
  dayDate?: string;
  day?: AlmanacOutput;
  isMonth?: boolean;
  monthKey?: string;
  monthDays?: Array<{ date: string; ganZhi: string; tenGod: string }>;
  monthSummary?: MonthSummary;
  error?: string;
  /** 解卦:跟着日运/月运结果走,重新查询就重置。缓存在服务里,这里只存状态。 */
  reading?: ReadingSlotState;
}

/** 流日的一行(与 FortuneStorage.monthDays 同形)。 */
interface MonthDayEntry {
  date: string;
  ganZhi: string;
  tenGod: string;
}

/** 旬:月内按日号三等分(01–10 / 11–20 / 21–月末)。 */
const XUN_NAMES = ["上旬", "中旬", "下旬"] as const;

/** 日号:日期库给的是不是补零的 ISO 都认;解析不了按 1 算(落上旬)。 */
function dayOfMonth(date: string): number {
  const match = /^\d{4}-(\d{1,2})-(\d{1,2})$/.exec(date);
  return match === null ? 1 : Number(match[2]);
}

/** 「2026-09-01」与「2026-9-1」都写成 09-01:提示词与标签里的日期要一个写法。 */
function monthDayText(date: string): string {
  const match = /^\d{4}-(\d{1,2})-(\d{1,2})$/.exec(date);
  if (match === null) return date;
  return `${(match[1] ?? "").padStart(2, "0")}-${(match[2] ?? "").padStart(2, "0")}`;
}

/**
 * 月运的逐日数据折成三条旬事实。
 *
 * 不逐日发给模型:输出侧要 600–1200 字、【逐条】只给几行,31 天逐日既写不下、
 * 也读不出重点;旬与提示词给月运定的口径(月运以旬给进退)一致。
 * 但每一天都要原样落在某一旬里 —— 只发前十天,模型就只会断前十天。
 */
function xunFacts(monthDays: ReadonlyArray<MonthDayEntry>): DivinationReadingFact[] {
  const groups = XUN_NAMES.map((name) => ({ name, entries: [] as MonthDayEntry[] }));
  for (const entry of monthDays) {
    const day = dayOfMonth(entry.date);
    const index = day <= 10 ? 0 : day <= 20 ? 1 : 2;
    groups[index]?.entries.push(entry);
  }
  return groups.filter((group) => group.entries.length > 0).map((group) => {
    const pad = (value: number): string => String(value).padStart(2, "0");
    const dayNumbers = group.entries.map((entry) => dayOfMonth(entry.date));
    const days = group.entries
      .map((entry) => `${monthDayText(entry.date)} ${entry.ganZhi}${entry.tenGod}`)
      .join("；");
    // 不附「本旬十神：各一天」这类统计:天干十位一轮,一整旬里十神必然每样一天,
    // 那是零信息;旬与旬的差别在起止日支与具体落在哪几天。
    // 标签要能被解卦块的行正则认出来:不含空格、不超 14 字。
    const range = `${pad(Math.min(...dayNumbers))}–${pad(Math.max(...dayNumbers))}`;
    return { label: `${group.name}（${range}）`, value: days };
  });
}

/** 解卦请求:日运看当天干支与本命日主的关系;月运看流月与逐旬的进退。 */
function readingRequestOf(storage: FortuneStorage): DivinationReadingRequest | null {
  const dayMaster = storage.dayMaster ?? "";
  const day = storage.day;
  const monthSummary = storage.monthSummary;
  const monthDays = storage.monthDays ?? [];

  if (storage.isMonth === true) {
    if (monthSummary === undefined) return null;
    const byTenGod = new Map<string, number>();
    for (const entry of monthDays) {
      const key = entry.tenGod === "" ? "未标十神" : entry.tenGod;
      byTenGod.set(key, (byTenGod.get(key) ?? 0) + 1);
    }
    const facts: DivinationReadingFact[] = [
      { label: "本命日主", value: [dayMaster, storage.gender === "female" ? "女命" : "男命"].filter((part) => part !== "").join(" · ") },
      {
        label: "流月",
        value: `${storage.monthKey ?? ""} · ${monthSummary.ganZhi}月 · 节气${monthSummary.jieQi} · ${monthSummary.startDate}～${monthSummary.endDate}`,
      },
      {
        label: "流月与本命",
        value: [
          monthSummary.tenGod === "" ? "" : `十神${monthSummary.tenGod}`,
          monthSummary.naYin === "" ? "" : `纳音${monthSummary.naYin}`,
          monthSummary.diShi === "" ? "" : `地势${monthSummary.diShi}`,
          elementRelationNote(dayMaster, monthSummary.ganZhi.slice(0, 1), "月"),
        ].filter((part) => part !== "").join(" · "),
      },
      {
        label: "当月十神分布",
        value: [...byTenGod.entries()].map(([name, count]) => `${name}${count}天`).join(" · "),
      },
      // 逐日是三条旬事实,不是「前十天」:全月的每一天都在里面。
      ...xunFacts(monthDays),
    ];
    return {
      kind: "method",
      method: "fortune",
      cacheKey: `${storage.birthDate ?? ""}|${storage.birthTime ?? ""}|${storage.gender ?? ""}|month|${storage.monthKey ?? ""}|${storage.dayDate ?? ""}`,
      momentText: storage.monthKey ?? "",
      question: "",
      facts: facts.filter((fact) => fact.value !== ""),
    };
  }

  if (day === undefined) return null;
  const ganZhi = day.dayInfo?.ganZhi ?? day.date;
  const almanac = (day.almanac ?? {}) as unknown as Record<string, unknown>;
  const suitable = Array.isArray(almanac.suitable) ? (almanac.suitable as string[]) : [];
  const avoid = Array.isArray(almanac.avoid) ? (almanac.avoid as string[]) : [];
  const facts: DivinationReadingFact[] = [
    { label: "本命日主", value: [dayMaster, storage.gender === "female" ? "女命" : "男命"].filter((part) => part !== "").join(" · ") },
    { label: "当日干支", value: `${day.date} ${ganZhi}日` },
    { label: "当日十神", value: tenGodOf(dayMaster, day.dayInfo?.stem ?? "") },
  ];
  const relation = elementRelationNote(dayMaster, day.dayInfo?.stem ?? "", "日");
  if (relation !== "") facts.push({ label: "日主与当日五行", value: relation });
  // 宜忌合成一条:它们是黄历给的字段,不是可逐条断的项 ——
  // 拆成「宜」「忌」两行,【逐条】就会照着标签把黄历再复述一遍。
  const yiJi = [
    suitable.length > 0 ? `宜 ${suitable.join("、")}` : "",
    avoid.length > 0 ? `忌 ${avoid.join("、")}` : "",
  ].filter((part) => part !== "");
  if (yiJi.length > 0) facts.push({ label: "黄历宜忌", value: yiJi.join("；") });
  const lunarDate = typeof almanac.lunarDate === "string" ? almanac.lunarDate : "";
  const chongSha = typeof almanac.chongSha === "string" ? almanac.chongSha : "";
  if (lunarDate !== "" || chongSha !== "") {
    facts.push({ label: "农历与冲煞", value: [lunarDate, chongSha].filter((part) => part !== "").join(" · ") });
  }
  return {
    kind: "method",
    method: "fortune",
    cacheKey: `${storage.birthDate ?? ""}|${storage.birthTime ?? ""}|${storage.gender ?? ""}|day|${storage.dayDate ?? ""}`,
    momentText: storage.dayDate ?? day.date,
    question: "",
    facts: facts.filter((fact) => fact.value !== ""),
  };
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function monthDayKeys(key: string): string[] {
  const match = MONTH_PATTERN.exec(key);
  if (match === null) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const total = new Date(year, month, 0).getDate();
  const keys: string[] = [];
  for (let day = 1; day <= total; day += 1) {
    keys.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return keys;
}

/** 2026-09-07 → 09-07;长度异常时原样返回。 */
function shortDate(value: string): string {
  return value.length >= 10 ? value.slice(5) : value;
}

function dayGanZhi(almanac: AlmanacOutput): string {
  return almanac.dayInfo?.ganZhi ?? almanac.date;
}

function tenGodLabel(storage: FortuneStorage, ganZhi: string): string {
  if (storage.dayMaster === undefined) return "";
  return tenGodOf(storage.dayMaster, ganZhi.slice(0, 1));
}

function renderDay(host: HTMLElement, storage: FortuneStorage, reading?: ReadingSlot): void {
  const doc = host.ownerDocument;
  const holder = doc.createElement("div");
  holder.className = "ad-fo-day";
  const almanac = storage.day;
  if (almanac === undefined) {
    holder.append(createPanelNotice(host, "empty", "填好出生信息后,这里给出当日干支与十神简评。"));
    host.replaceChildren(holder);
    return;
  }
  const detail = (typeof almanac.almanac === "object" && almanac.almanac !== null
    ? almanac.almanac
    : {}) as Record<string, unknown>;
  const ganZhi = dayGanZhi(almanac);

  const card = createResultCard(host, `${almanac.date} ${ganZhi}日`);
  const body = card.body;
  if (storage.dayMaster !== undefined) {
    const line = doc.createElement("p");
    line.className = "ad-fo-line";
    line.textContent = `日主 ${storage.dayMaster} · 当日十神 ${tenGodLabel(storage, ganZhi)}`;
    body.append(line);
    const note = doc.createElement("p");
    note.className = "ad-fo-note";
    note.textContent = elementRelationNote(storage.dayMaster, ganZhi.slice(0, 1), "日");
    body.append(note);
  }
  const yi = Array.isArray(detail.suitable)
    ? detail.suitable.filter((item): item is string => typeof item === "string")
    : [];
  const ji = Array.isArray(detail.avoid)
    ? detail.avoid.filter((item): item is string => typeof item === "string")
    : [];
  if (yi.length > 0 || ji.length > 0) {
    const chips = doc.createElement("div");
    chips.className = "ad-bp-chips";
    if (yi.length > 0) chips.append(createChip(host, `宜 ${yi.slice(0, 4).join(" ")}`, true));
    if (ji.length > 0) chips.append(createChip(host, `忌 ${ji.slice(0, 4).join(" ")}`));
    body.append(chips);
  }
  const lunar = doc.createElement("p");
  lunar.className = "ad-fo-line ad-fo-line--muted";
  lunar.textContent = `农历${typeof detail.lunarDate === "string" ? detail.lunarDate : ""}${typeof detail.chongSha === "string" ? ` · ${detail.chongSha}` : ""}`;
  body.append(lunar);
  reading?.paintInto(card.body);
  holder.append(card.root);
  host.replaceChildren(holder);
}

function renderMonth(host: HTMLElement, storage: FortuneStorage, reading?: ReadingSlot): void {
  const doc = host.ownerDocument;
  const holder = doc.createElement("div");
  holder.className = "ad-fo-month";
  const days = storage.monthDays;
  if (days === undefined || days.length === 0) {
    holder.append(createPanelNotice(host, "empty", "填好出生信息后,这里铺出当月逐日干支。"));
    host.replaceChildren(holder);
    return;
  }
  const card = createResultCard(host, `${storage.monthKey ?? ""} 流月`);
  const body = card.body;

  const summary = storage.monthSummary;
  if (summary !== undefined) {
    const line = doc.createElement("p");
    line.className = "ad-fo-line";
    line.textContent = `流月 ${summary.ganZhi} · ${summary.jieQi}（${shortDate(summary.startDate)} ~ ${shortDate(summary.endDate)}）`;
    body.append(line);
    const meta = [
      summary.tenGod === "" ? "" : `日主十神 ${summary.tenGod}`,
      summary.naYin === "" ? "" : `纳音${summary.naYin}`,
      summary.diShi === "" ? "" : `地势${summary.diShi}`,
    ].filter((part) => part !== "").join(" · ");
    if (meta !== "") {
      const metaLine = doc.createElement("p");
      metaLine.className = "ad-fo-line ad-fo-line--muted";
      metaLine.textContent = meta;
      body.append(metaLine);
    }
    const note = doc.createElement("p");
    note.className = "ad-fo-note";
    note.textContent = elementRelationNote(storage.dayMaster ?? "", summary.ganZhi.slice(0, 1), "月");
    if (note.textContent !== "") body.append(note);
  }

  const grid = doc.createElement("div");
  grid.className = "ad-fo-grid";
  const todayKey = localDateKey(new Date());
  for (const day of days) {
    const cell = doc.createElement("div");
    cell.className = day.date === todayKey ? "ad-fo-grid__day ad-fo-grid__day--today" : "ad-fo-grid__day";
    const number = doc.createElement("span");
    number.className = "ad-fo-grid__num";
    number.textContent = day.date.slice(8);
    const gz = doc.createElement("span");
    gz.className = "ad-fo-grid__gz";
    gz.textContent = day.ganZhi;
    const tenGod = doc.createElement("span");
    tenGod.className = "ad-fo-grid__tengod";
    tenGod.textContent = day.tenGod;
    cell.append(number, gz, tenGod);
    grid.append(cell);
  }
  body.append(grid);

  reading?.paintInto(card.body);
  holder.append(card.root);
  host.replaceChildren(holder);
}

function renderResult(host: HTMLElement, storage: FortuneStorage, reading?: ReadingSlot): void {
  if (storage.error !== undefined) {
    const notice = createPanelNotice(host, "error", storage.error);
    host.replaceChildren(notice);
    return;
  }
  if (storage.isMonth === true) renderMonth(host, storage, reading);
  else renderDay(host, storage, reading);
}

/** 日运/月运:以出生信息定日主,再取当日/当月干支做十神简评。 */
export const fortunePanel: BusiPanel = {
  id: "fortune",
  label: "日运月运",
  render(host, storage, ctx) {
    const raw = storage as FortuneStorage;
    const now = new Date();
    raw.isMonth = raw.isMonth ?? false;
    const birthDate = raw.birthDate ?? `${now.getFullYear()}-01-01`;
    const birthTime = raw.birthTime ?? "10:00";
    const gender = raw.gender ?? "male";
    const dayDate = raw.dayDate ?? localDateKey(now);
    const monthKey = raw.monthKey ?? dayDate.slice(0, 7);

    host.replaceChildren();
    const doc = host.ownerDocument;
    const form = doc.createElement("form");
    form.className = "ad-bp-form";
    form.addEventListener("submit", (event) => event.preventDefault());

    const dateInput = doc.createElement("input");
    dateInput.type = "date";
    dateInput.value = birthDate;
    dateInput.className = "ad-bp-input";
    dateInput.setAttribute("aria-label", "出生日期");
    const timeInput = doc.createElement("input");
    timeInput.type = "time";
    timeInput.value = birthTime;
    timeInput.className = "ad-bp-input";
    timeInput.setAttribute("aria-label", "出生时间");
    const genderSegmented = createSegmented(
      host,
      [
        { value: "male", label: "男" },
        { value: "female", label: "女" },
      ],
      gender,
      (value) => { raw.gender = value === "female" ? "female" : "male"; },
      "性别",
    );
    const dayInput = doc.createElement("input");
    dayInput.type = "date";
    dayInput.value = dayDate;
    dayInput.className = "ad-bp-input";
    dayInput.setAttribute("aria-label", "查询日期");
    const monthInput = doc.createElement("input");
    monthInput.type = "month";
    monthInput.value = monthKey;
    monthInput.className = "ad-bp-input";
    monthInput.setAttribute("aria-label", "查询月份");
    const monthField = doc.createElement("div");
    monthField.className = "ad-bp-field";
    monthField.style.display = raw.isMonth ? "" : "none";
    const monthLabel = doc.createElement("span");
    monthLabel.className = "ad-bp-field__label";
    monthLabel.textContent = "查询月份";
    monthField.append(monthLabel, monthInput);

    const resultHost = doc.createElement("div");
    resultHost.className = "ad-bp-panel__result-host";
    const reading = createReadingSlot({
      host,
      storage: raw,
      ctx,
      build: () => readingRequestOf(raw),
    });

    const viewSegmented = createSegmented(
      host,
      [
        { value: "day", label: "日运" },
        { value: "month", label: "月运" },
      ],
      raw.isMonth ? "month" : "day",
      (value) => {
        raw.isMonth = value === "month";
        monthField.style.display = raw.isMonth ? "" : "none";
        // 日运/月运共用同一个解卦槽：切过去之后，旧的解卦文字说的不是这一盘。
        raw.reading = undefined;
        renderResult(resultHost, raw, reading);
      },
      "运势视图",
    );

    const submit = createSubmitButton(host, "排运", () => {
      raw.birthDate = dateInput.value;
      raw.birthTime = timeInput.value;
      raw.dayDate = dayInput.value;
      raw.monthKey = monthInput.value;
      // 上一盘的解卦不跟着新盘走（对照 xiaoliurenPanel/tarotPanel 的同类处理）。
      raw.reading = undefined;
      const dateMatch = DATE_PATTERN.exec(dateInput.value);
      const timeMatch = TIME_PATTERN.exec(timeInput.value);
      const dayMatch = DATE_PATTERN.exec(dayInput.value);
      if (dateMatch === null || timeMatch === null || dayMatch === null) {
        raw.error = "请填写完整的出生与查询日期";
        renderResult(resultHost, raw, reading);
        return;
      }
      const keys = raw.isMonth === true ? monthDayKeys(monthInput.value) : [dayInput.value];
      const firstKey = keys[0];
      const lastKey = keys[keys.length - 1];
      if (firstKey === undefined || lastKey === undefined) {
        raw.error = raw.isMonth === true ? "查询月份不合法" : "查询日期不合法";
        renderResult(resultHost, raw, reading);
        return;
      }
      raw.error = undefined;
      renderResult(resultHost, raw, reading);
      const input: BaziInput = {
        birthYear: Number(dateMatch[1]),
        birthMonth: Number(dateMatch[2]),
        birthDay: Number(dateMatch[3]),
        birthHour: Number(timeMatch[1]),
        birthMinute: Number(timeMatch[2]),
        gender: raw.gender ?? "male",
      };
      const requests = requestTokenFor(raw);
      const token = requests.next();
      void (async () => {
        try {
          const bazi = await Promise.resolve(calculateBazi(input));
          // 连点两次排运时，先发起的那次结果不许再写回。
          if (!requests.isCurrent(token)) return;
          raw.dayMaster = bazi.dayMaster;
          const context = {
            dayStem: bazi.fourPillars.day.stem,
            dayBranch: bazi.fourPillars.day.branch,
            yearBranch: bazi.fourPillars.year.branch,
          };
          if (raw.isMonth === true) {
            // 流日:逐日干支/十神走库的流日表(与黄历同源,实测干支逐日一致)。
            raw.monthDays = calculateBaziLiuRiData(firstKey, lastKey, context).map((entry) => ({
              date: entry.date,
              ganZhi: entry.ganZhi,
              tenGod: entry.tenGod ?? "",
            }));
            // 流月:按节气月取月柱干支;1 月的日期落在上一年表的小寒段,故两张表合并后再查。
            const reference = liuYueReferenceDate(monthInput.value, dayInput.value);
            const referenceYear = Number(reference.slice(0, 4));
            const liuYueTable = [
              ...calculateBaziLiuYueData(referenceYear - 1, context),
              ...calculateBaziLiuYueData(referenceYear, context),
            ];
            const hit = findLiuYue(liuYueTable, reference);
            if (hit === undefined) {
              raw.monthSummary = undefined;
              raw.error = "取不到该月的流月干支";
            } else {
              raw.monthSummary = {
                ganZhi: hit.ganZhi,
                tenGod: hit.tenGod ?? "",
                jieQi: hit.jieQi,
                startDate: hit.startDate,
                endDate: hit.endDate,
                naYin: hit.naYin ?? "",
                diShi: hit.diShi ?? "",
              };
            }
          } else {
            const day = await Promise.resolve(calculateDailyAlmanac({ date: dayInput.value }));
            if (!requests.isCurrent(token)) return;
            raw.day = day;
          }
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
      createField(host, "出生日期", dateInput),
      createField(host, "出生时间", timeInput),
      createField(host, "性别", genderSegmented.root),
      createField(host, "查询日期", dayInput),
      monthField,
      createField(host, "视图", viewSegmented.root),
      submit,
    );
    host.append(form);
    host.append(resultHost);
    renderResult(resultHost, raw, reading);

    return () => {
      genderSegmented.cleanup();
      viewSegmented.cleanup();
      host.replaceChildren();
    };
  },
  harvest(host, storage) {
    const raw = storage as FortuneStorage;
    const birthDate = readInputValue(host, "出生日期");
    const birthTime = readInputValue(host, "出生时间");
    const gender = readSegmentedValue(host, "性别");
    const dayDate = readInputValue(host, "查询日期");
    const monthKey = readInputValue(host, "查询月份");
    const view = readSegmentedValue(host, "运势视图");
    if (birthDate !== undefined) raw.birthDate = birthDate;
    if (birthTime !== undefined) raw.birthTime = birthTime;
    if (gender === "male" || gender === "female") raw.gender = gender;
    if (dayDate !== undefined) raw.dayDate = dayDate;
    if (monthKey !== undefined) raw.monthKey = monthKey;
    if (view !== undefined) raw.isMonth = view === "month";
  },
};
