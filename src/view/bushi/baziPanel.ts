import {
  calculateBazi,
  calculateBaziFiveElementsStats,
} from "taibu-core/bazi";
import type { BaziInput, BaziOutput } from "taibu-core/bazi";
import { calculateBaziDayun as computeDayun } from "taibu-core/bazi-dayun";
import type { DayunInput, DayunOutput } from "taibu-core/bazi-dayun";
import type { BusiPanel } from "../../features/divination/bushiTypes";
import { currentDayunIndex } from "../../features/divination/dayun";
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
  createSelectField,
  createSubmitButton,
  createTextField,
  readCheckboxValue,
  readInputValue,
  readNumberValue,
  readSegmentedValue,
  type SelectOption,
} from "./bushiUi";

interface BaziStorage {
  birthDate?: string;
  birthTime?: string;
  gender?: "male" | "female";
  calendarType?: "solar" | "lunar";
  isLeapMonth?: boolean;
  name?: string;
  trueSolar?: boolean;
  longitudeChoice?: string;
  customLongitude?: number;
  result?: BaziOutput;
  dayun?: DayunOutput;
  error?: string;
  /** 解卦:跟着 result 走,重新排盘就重置。缓存在服务里,这里只存状态。 */
  reading?: ReadingSlotState;
}

/** 解卦请求:四柱、十神、空亡与柱间关系是断八字的主干;大运只报当前这一步。 */
function readingFactsOf(storage: BaziStorage, output: BaziOutput): DivinationReadingFact[] {
  const facts: DivinationReadingFact[] = [];
  const pillar = (label: string, info: BaziOutput["fourPillars"]["year"]): void => {
    facts.push({
      label,
      value: [
        `${info.stem}${info.branch}`,
        info.tenGod === undefined || info.tenGod === "" ? "" : info.tenGod,
        info.naYin === undefined || info.naYin === "" ? "" : `纳音${info.naYin}`,
        info.diShi === undefined || info.diShi === "" ? "" : `地势${info.diShi}`,
        info.shenSha.length > 0 ? `神煞${info.shenSha.join("、")}` : "",
      ].filter((part) => part !== "").join(" · "),
    });
  };
  pillar("年柱", output.fourPillars.year);
  pillar("月柱", output.fourPillars.month);
  pillar("日柱", output.fourPillars.day);
  pillar("时柱", output.fourPillars.hour);
  facts.push({
    label: "日主与格局",
    value: [
      `日主${output.dayMaster}`,
      `${storage.gender === "female" ? "女命" : "男命"}`,
      `旬空${output.kongWang.kongZhi.join("、")}`,
      output.mingGong === undefined ? "" : `命宫${output.mingGong}`,
      output.taiYuan === undefined ? "" : `胎元${output.taiYuan}`,
    ].filter((part) => part !== "").join(" · "),
  });
  const relations = [
    ...output.relations.map((relation) => `${relation.pillars.join("")}${relation.type}：${relation.description}`),
    ...output.tianGanWuHe.map((item) => `天干合：${item.stemA}${item.stemB}化${item.resultElement}`),
    ...output.tianGanChongKe.map((item) => `天干冲克：${item.stemA}${item.stemB}`),
    ...output.diZhiBanHe.map((item) => `地支半合：${item.branches.join("")}化${item.resultElement}`),
    ...output.diZhiSanHui.map((item) => `地支三会：${item.branches.join("")}化${item.resultElement}`),
  ];
  if (relations.length > 0) facts.push({ label: "柱间关系", value: relations.join("；") });

  const dayun = storage.dayun;
  if (dayun !== undefined) {
    const index = currentDayunIndex(dayun.list.map((step) => step.startYear), new Date().getFullYear());
    // 命中下标是 0 基；-1 表示还没起运（第一步大运之前）。原写法取 index-1，恒报上一步。
    const current = index >= 0 ? dayun.list[index] : undefined;
    if (current !== undefined) {
      facts.push({
        label: "当前大运",
        value: `${current.ganZhi}（${current.startAge}岁起 · ${current.tenGod}）`,
      });
    }
    facts.push({ label: "起运", value: dayun.startAgeDetail });
  }
  return facts;
}

const PILLAR_LABELS: ReadonlyArray<readonly [keyof BaziOutput["fourPillars"], string]> = [
  ["year", "年柱"],
  ["month", "月柱"],
  ["day", "日柱"],
  ["hour", "时柱"],
];

const FIVE_ELEMENTS: ReadonlyArray<{ key: "金" | "木" | "水" | "火" | "土"; label: string; color: string }> = [
  { key: "金", label: "金", color: "#c9b26b" },
  { key: "木", label: "木", color: "#6f9a5c" },
  { key: "水", label: "水", color: "#5c86a8" },
  { key: "火", label: "火", color: "#b25736" },
  { key: "土", label: "土", color: "#a08b6d" },
];

const LONGITUDE_OPTIONS: SelectOption[] = [
  { value: "116.4", label: "北京 116.4" },
  { value: "121.5", label: "上海 121.5" },
  { value: "104.1", label: "成都 104.1" },
  { value: "87.6", label: "乌鲁木齐 87.6" },
  { value: "custom", label: "自定义" },
];

const CALENDAR_OPTIONS: SelectOption[] = [
  { value: "solar", label: "公历" },
  { value: "lunar", label: "农历" },
];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function parseDate(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return { year, month, day };
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = TIME_PATTERN.exec(value);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return { hour, minute };
}

function buildInput(storage: BaziStorage): BaziInput | null {
  const date = parseDate(storage.birthDate ?? "");
  const time = parseTime(storage.birthTime ?? "");
  if (date === null || time === null) return null;
  const input: BaziInput = {
    birthYear: date.year,
    birthMonth: date.month,
    birthDay: date.day,
    birthHour: time.hour,
    birthMinute: time.minute,
    gender: storage.gender ?? "male",
  };
  if ((storage.calendarType ?? "solar") === "lunar") {
    input.calendarType = "lunar";
    if (storage.isLeapMonth === true) input.isLeapMonth = true;
  }
  if (storage.trueSolar === true) {
    const choice = storage.longitudeChoice ?? "116.4";
    if (choice === "custom") {
      if (typeof storage.customLongitude === "number") input.longitude = storage.customLongitude;
    } else {
      input.longitude = Number(choice);
    }
  }
  return input;
}

function chip(host: HTMLElement, text: string, tone: "neutral" | "warn" | "good" = "neutral"): HTMLElement {
  const element = createChip(host, text, tone !== "neutral");
  if (tone === "warn") element.classList.add("ad-bp-chip--warn");
  if (tone === "good") element.classList.add("ad-bp-chip--good");
  return element;
}

function renderPillar(
  host: HTMLElement,
  label: string,
  pillar: BaziOutput["fourPillars"]["year"],
  isDay: boolean,
): HTMLElement {
  const doc = host.ownerDocument;
  const card = doc.createElement("div");
  card.className = isDay ? "ad-bz-pillar ad-bz-pillar--day" : "ad-bz-pillar";

  const head = doc.createElement("div");
  head.className = "ad-bz-pillar__head";
  const labelElement = doc.createElement("span");
  labelElement.className = "ad-bz-pillar__label";
  labelElement.textContent = label;
  head.append(labelElement);
  if (isDay) {
    const badge = doc.createElement("span");
    badge.className = "ad-bz-pillar__badge";
    badge.textContent = "日主";
    head.append(badge);
  }

  const gz = doc.createElement("div");
  gz.className = "ad-bz-pillar__gz";
  const stem = doc.createElement("span");
  stem.className = "ad-bz-pillar__stem";
  stem.textContent = pillar.stem;
  const branch = doc.createElement("span");
  branch.className = "ad-bz-pillar__branch";
  branch.textContent = pillar.branch;
  gz.append(stem, branch);

  const tenGod = doc.createElement("p");
  tenGod.className = "ad-bz-pillar__tengod";
  tenGod.textContent = pillar.tenGod ?? "";

  const details = doc.createElement("dl");
  details.className = "ad-bz-pillar__details";
  const pushRow = (term: string, value: string): void => {
    const dt = doc.createElement("dt");
    dt.textContent = term;
    const dd = doc.createElement("dd");
    dd.textContent = value;
    details.append(dt, dd);
  };
  if (pillar.hiddenStems.length > 0) {
    pushRow("藏干", pillar.hiddenStems.map((item) => `${item.stem}(${item.tenGod})`).join(" "));
  }
  if (pillar.naYin !== undefined) pushRow("纳音", pillar.naYin);
  if (pillar.diShi !== undefined) pushRow("地势", pillar.diShi);
  if (pillar.shenSha.length > 0) pushRow("神煞", pillar.shenSha.join("、"));

  card.append(head, gz, tenGod, details);
  if (pillar.kongWang.isKong) {
    const kong = doc.createElement("span");
    kong.className = "ad-bz-pillar__kong";
    kong.textContent = "旬空";
    card.append(kong);
  }
  return card;
}

function renderResult(host: HTMLElement, storage: BaziStorage, reading?: ReadingSlot): void {
  const doc = host.ownerDocument;
  const holder = doc.createElement("div");
  holder.className = "ad-bp-panel__result";

  if (storage.error !== undefined) {
    holder.append(createPanelNotice(host, "error", storage.error));
    host.replaceChildren(holder);
    return;
  }
  const output = storage.result;
  const dayun = storage.dayun;
  if (output === undefined || dayun === undefined) {
    host.replaceChildren(holder);
    return;
  }

  const card = createResultCard(host, `${storage.name === undefined || storage.name === "" ? "八字排盘" : `${storage.name} 的排盘`}`);
  const body = card.body;

  const metaLine = doc.createElement("p");
  metaLine.className = "ad-bz-meta";
  metaLine.textContent = [
    `日主 ${output.dayMaster}`,
    `旬空 ${output.kongWang.xun}（${output.kongWang.kongZhi.join("")}）`,
    output.taiYuan === undefined ? "" : `胎元 ${output.taiYuan}`,
    output.mingGong === undefined ? "" : `命宫 ${output.mingGong}`,
  ].filter((part) => part !== "").join(" · ");
  body.append(metaLine);

  const pillars = doc.createElement("div");
  pillars.className = "ad-bz-pillars";
  for (const [key, label] of PILLAR_LABELS) {
    const pillar = output.fourPillars[key];
    if (pillar === undefined) continue;
    pillars.append(renderPillar(host, label, pillar, key === "day"));
  }
  body.append(pillars);

  const stats = calculateBaziFiveElementsStats(output.fourPillars);
  const total = FIVE_ELEMENTS.reduce((sum, entry) => sum + (stats[entry.key] ?? 0), 0);
  const bars = doc.createElement("div");
  bars.className = "ad-bz-wuxing";
  for (const entry of FIVE_ELEMENTS) {
    const value = stats[entry.key] ?? 0;
    const row = doc.createElement("div");
    row.className = "ad-bz-wuxing__row";
    const label = doc.createElement("span");
    label.className = "ad-bz-wuxing__label";
    label.textContent = entry.label;
    const track = doc.createElement("div");
    track.className = "ad-bz-wuxing__track";
    const fill = doc.createElement("div");
    fill.className = "ad-bz-wuxing__fill";
    fill.style.width = `${total === 0 ? 0 : Math.round((value / total) * 100)}%`;
    fill.style.background = entry.color;
    fill.title = `${entry.label} ${value}`;
    track.append(fill);
    const number = doc.createElement("span");
    number.className = "ad-bz-wuxing__value";
    number.textContent = String(value);
    row.append(label, track, number);
    bars.append(row);
  }
  body.append(bars);

  const relations: Array<{ text: string; tone: "neutral" | "warn" | "good" }> = [];
  for (const item of output.tianGanWuHe) relations.push({ text: `天干五合 ${item.stemA}${item.stemB} 合化${item.resultElement}（${item.positions.join("、")}）`, tone: "good" });
  for (const item of output.tianGanChongKe) relations.push({ text: `天干冲克 ${item.stemA}${item.stemB}（${item.positions.join("、")}）`, tone: "warn" });
  for (const item of output.diZhiBanHe) relations.push({ text: `地支半合 ${item.branches.join("")}（${item.positions.join("、")}）`, tone: "good" });
  for (const item of output.diZhiSanHui) relations.push({ text: `地支三会 ${item.branches.join("")} 会${item.resultElement}（${item.positions.join("、")}）`, tone: "good" });
  for (const item of output.relations) {
    relations.push({
      text: `${item.type}：${item.description}（${item.pillars.join("、")}）`,
      tone: item.type === "冲" || item.type === "刑" || item.type === "害" ? "warn" : "good",
    });
  }
  if (relations.length > 0) {
    const section = doc.createElement("div");
    section.className = "ad-bz-relations";
    const heading = doc.createElement("p");
    heading.className = "ad-bz-relations__heading";
    heading.textContent = "柱间关系";
    section.append(heading);
    const chips = doc.createElement("div");
    chips.className = "ad-bp-chips";
    for (const relation of relations) chips.append(chip(host, relation.text, relation.tone));
    section.append(chips);
    body.append(section);
  }

  const dayunSection = doc.createElement("div");
  dayunSection.className = "ad-bz-dayun";
  const heading = doc.createElement("p");
  heading.className = "ad-bz-relations__heading";
  // 库的 startAgeDetail 自带「…起运」后缀;startAge 是虚岁,只用于显示。
  heading.textContent = `大运 · ${dayun.startAgeDetail}（${dayun.startAge} 岁）`;
  dayunSection.append(heading);
  const strip = doc.createElement("div");
  strip.className = "ad-bz-dayun__strip";
  // 当前步按库给出的 startYear 区间判定(虚岁 startAge 直接当年份差会晚一年)。
  const currentIndex = currentDayunIndex(dayun.list.map((step) => step.startYear), new Date().getFullYear());
  for (const [index, step] of dayun.list.entries()) {
    const item = doc.createElement("div");
    const isCurrent = index === currentIndex;
    item.className = isCurrent ? "ad-bz-dayun__step ad-bz-dayun__step--current" : "ad-bz-dayun__step";
    const gz = doc.createElement("strong");
    gz.className = "ad-bz-dayun__gz";
    gz.textContent = step.ganZhi;
    const ageLine = doc.createElement("span");
    ageLine.className = "ad-bz-dayun__age";
    ageLine.textContent = `${step.startAge}–${step.startAge + 9} 岁`;
    const tenGod = doc.createElement("span");
    tenGod.className = "ad-bz-dayun__tengod";
    tenGod.textContent = step.tenGod;
    item.append(gz, ageLine, tenGod);
    strip.append(item);
  }
  dayunSection.append(strip);
  if (dayun.xiaoYun.length > 0) {
    const xiao = doc.createElement("p");
    xiao.className = "ad-bz-dayun__xiaoyun";
    xiao.textContent = `小运：${dayun.xiaoYun.map((item) => `${item.age}岁 ${item.ganZhi}`).join(" · ")}`;
    dayunSection.append(xiao);
  }
  body.append(dayunSection);

  reading?.paintInto(card.body);
  holder.append(card.root);
  host.replaceChildren(holder);
}

/**
 * 八字体板:出生信息 → 四柱 + 关系 + 五行统计 + 大运。
 * 大运的“当前步”按出生年与运行年份推算,不写死任何测试日期。
 */
export const baziPanel: BusiPanel = {
  id: "bazi",
  label: "八字",
  render(host, storage, ctx) {
    const raw = storage as BaziStorage;
    const now = new Date();
    const birthDate = raw.birthDate ?? `${now.getFullYear()}-01-01`;
    const birthTime = raw.birthTime ?? "10:00";
    const gender = raw.gender ?? "male";
    const calendarType = raw.calendarType ?? "solar";
    const trueSolar = raw.trueSolar ?? false;
    const longitudeChoice = raw.longitudeChoice ?? "116.4";

    host.replaceChildren();
    const form = host.ownerDocument.createElement("form");
    form.className = "ad-bp-form";
    form.addEventListener("submit", (event) => event.preventDefault());

    const dateInput = host.ownerDocument.createElement("input");
    dateInput.type = "date";
    dateInput.value = birthDate;
    dateInput.className = "ad-bp-input";
    dateInput.setAttribute("aria-label", "出生日期");

    const timeInput = host.ownerDocument.createElement("input");
    timeInput.type = "time";
    timeInput.value = birthTime;
    timeInput.className = "ad-bp-input";
    timeInput.setAttribute("aria-label", "出生时间");

    const nameInput = createTextField(host, "姓名(可选)", raw.name ?? "", "姓名");

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

    const calendarSelect = createSelectField(host, "历法", CALENDAR_OPTIONS, calendarType);
    const leapWrap = host.ownerDocument.createElement("div");
    leapWrap.className = "ad-bp-field ad-bp-field--inline";
    const leapInput = host.ownerDocument.createElement("input");
    leapInput.type = "checkbox";
    leapInput.className = "ad-bp-checkbox";
    leapInput.checked = raw.isLeapMonth === true;
    leapInput.id = "ad-bz-leap";
    const leapLabel = host.ownerDocument.createElement("label");
    leapLabel.className = "ad-bp-field__label ad-bp-field__label--inline";
    leapLabel.textContent = "闰月";
    leapLabel.htmlFor = leapInput.id;
    leapWrap.append(leapInput, leapLabel);
    leapWrap.style.display = calendarType === "lunar" ? "" : "none";
    calendarSelect.addEventListener("change", () => {
      raw.calendarType = calendarSelect.value === "lunar" ? "lunar" : "solar";
      leapWrap.style.display = calendarSelect.value === "lunar" ? "" : "none";
    });

    const trueSolarWrap = host.ownerDocument.createElement("div");
    trueSolarWrap.className = "ad-bp-field ad-bp-field--inline";
    const trueSolarInput = host.ownerDocument.createElement("input");
    trueSolarInput.type = "checkbox";
    trueSolarInput.className = "ad-bp-checkbox";
    trueSolarInput.checked = trueSolar;
    trueSolarInput.id = "ad-bz-true-solar";
    const trueSolarLabel = host.ownerDocument.createElement("label");
    trueSolarLabel.className = "ad-bp-field__label ad-bp-field__label--inline";
    trueSolarLabel.textContent = "真太阳时";
    trueSolarLabel.htmlFor = trueSolarInput.id;
    trueSolarWrap.append(trueSolarInput, trueSolarLabel);

    const longitudeSelect = createSelectField(host, "参考经度", LONGITUDE_OPTIONS, longitudeChoice);
    const longitudeWrap = createField(host, "参考经度", longitudeSelect);
    longitudeWrap.style.display = trueSolar ? "" : "none";
    const customLongitudeInput = host.ownerDocument.createElement("input");
    customLongitudeInput.type = "number";
    customLongitudeInput.className = "ad-bp-input";
    customLongitudeInput.step = "0.1";
    customLongitudeInput.min = "73";
    customLongitudeInput.max = "135";
    customLongitudeInput.placeholder = "经度 73–135";
    customLongitudeInput.setAttribute("aria-label", "自定义经度");
    customLongitudeInput.value = raw.customLongitude === undefined ? "" : String(raw.customLongitude);
    const customWrap = createField(host, "自定义经度", customLongitudeInput);
    customWrap.style.display = trueSolar && longitudeChoice === "custom" ? "" : "none";
    longitudeSelect.addEventListener("change", () => {
      raw.longitudeChoice = longitudeSelect.value;
      customWrap.style.display = longitudeSelect.value === "custom" ? "" : "none";
    });
    trueSolarInput.addEventListener("change", () => {
      raw.trueSolar = trueSolarInput.checked;
      longitudeWrap.style.display = trueSolarInput.checked ? "" : "none";
      customWrap.style.display = trueSolarInput.checked && longitudeSelect.value === "custom" ? "" : "none";
    });

    const resultHost = host.ownerDocument.createElement("div");
    resultHost.className = "ad-bp-panel__result-host";
    const reading = createReadingSlot({
      host,
      storage: raw,
      ctx,
      build: () => (raw.result === undefined ? null : {
        kind: "method" as const,
        method: "bazi",
        // 排盘由出生信息与折算后的经度唯一决定;姓名不参与计算,也不进键。
        cacheKey: [
          raw.birthDate ?? "",
          raw.birthTime ?? "",
          raw.gender ?? "male",
          raw.calendarType ?? "solar",
          raw.isLeapMonth === true ? "leap" : "",
          raw.trueSolar === true ? `${raw.longitudeChoice ?? ""}:${raw.customLongitude ?? ""}` : "",
        ].join("|"),
        momentText: raw.birthDate ?? "",
        question: "",
        facts: readingFactsOf(raw, raw.result),
      }),
    });

    const submit = createSubmitButton(host, "排盘", () => {
      raw.birthDate = dateInput.value;
      raw.birthTime = timeInput.value;
      raw.name = nameInput.value;
      raw.calendarType = calendarSelect.value === "lunar" ? "lunar" : "solar";
      raw.isLeapMonth = leapInput.checked;
      raw.trueSolar = trueSolarInput.checked;
      raw.longitudeChoice = longitudeSelect.value;
      raw.customLongitude = customLongitudeInput.value === "" ? undefined : Number(customLongitudeInput.value);
      // 自定义经度只在库侧报错(「longitude 必须是 -180 到 180」),面板按常用范围先拦。
      if (raw.trueSolar === true && raw.longitudeChoice === "custom") {
        const longitude = raw.customLongitude;
        if (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < 73 || longitude > 135) {
          raw.error = "经度取 73–135";
          raw.result = undefined;
          raw.dayun = undefined;
          renderResult(resultHost, raw, reading);
          return;
        }
      }
      const input = buildInput(raw);
      if (input === null) {
        raw.error = "请填写完整的出生日期与时间";
        raw.result = undefined;
        raw.dayun = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      raw.error = undefined;
      raw.result = undefined;
      raw.dayun = undefined;
      // 上一张命盘的解卦不跟着新盘走。
      raw.reading = undefined;
      renderResult(resultHost, raw, reading);
      const requests = requestTokenFor(raw);
      const token = requests.next();
      void (async () => {
        try {
          const [bazi, dayun] = await Promise.all([
            Promise.resolve(calculateBazi(input)),
            Promise.resolve(computeDayun(input as DayunInput)),
          ]);
          // 连点两次排盘时，先发起的那次结果不许再写回。
          if (!requests.isCurrent(token)) return;
          raw.result = bazi;
          raw.dayun = dayun;
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
      createField(host, "姓名(可选)", nameInput),
      createField(host, "性别", genderSegmented.root),
      createField(host, "历法", calendarSelect),
      leapWrap,
      trueSolarWrap,
      longitudeWrap,
      customWrap,
      submit,
    );
    host.append(form);
    host.append(resultHost);
    renderResult(resultHost, raw, reading);

    return () => {
      genderSegmented.cleanup();
      host.replaceChildren();
    };
  },
  harvest(host, storage) {
    const raw = storage as BaziStorage;
    const birthDate = readInputValue(host, "出生日期");
    const birthTime = readInputValue(host, "出生时间");
    const name = readInputValue(host, "姓名(可选)");
    const gender = readSegmentedValue(host, "性别");
    const calendarType = readInputValue(host, "历法");
    const isLeapMonth = readCheckboxValue(host, "闰月");
    const trueSolar = readCheckboxValue(host, "真太阳时");
    const longitudeChoice = readInputValue(host, "参考经度");
    const customLongitude = readNumberValue(host, "自定义经度");
    if (birthDate !== undefined) raw.birthDate = birthDate;
    if (birthTime !== undefined) raw.birthTime = birthTime;
    if (name !== undefined) raw.name = name;
    if (gender === "male" || gender === "female") raw.gender = gender;
    if (calendarType !== undefined) raw.calendarType = calendarType === "lunar" ? "lunar" : "solar";
    if (isLeapMonth !== undefined) raw.isLeapMonth = isLeapMonth;
    if (trueSolar !== undefined) raw.trueSolar = trueSolar;
    if (longitudeChoice !== undefined) raw.longitudeChoice = longitudeChoice;
    if (customLongitude !== undefined) raw.customLongitude = customLongitude;
  },
};
