import { calculateZiwei } from "taibu-core/ziwei";
import type { ZiweiInput, ZiweiOutput } from "taibu-core/ziwei";
import type { BusiPanel } from "../../features/divination/bushiTypes";
import type { DivinationReadingFact } from "../../features/divination/divinationReading";
import { createReadingSlot, type ReadingSlot, type ReadingSlotState } from "./readingSlot";
import { requestTokenFor } from "./panelToken";
import {
  collectError,
  createChip,
  createCheckboxField,
  createField,
  createPanelNotice,
  createResultCard,
  createSegmented,
  createSelectField,
  createSubmitButton,
  readCheckboxValue,
  readInputValue,
  readNumberValue,
  readSegmentedValue,
  type SelectOption,
} from "./bushiUi";

interface ZiweiStorage {
  birthDate?: string;
  birthTime?: string;
  gender?: "male" | "female";
  trueSolar?: boolean;
  longitudeChoice?: string;
  customLongitude?: number;
  result?: ZiweiOutput;
  error?: string;
  /** 解卦:跟着 result 走,重新排盘就重置。缓存在服务里,这里只存状态。 */
  reading?: ReadingSlotState;
}

/** 解卦请求:命宫三方四正、四化与五行局是断盘的主干,其余宫位由模型按问题取用。 */
function readingFactsOf(storage: ZiweiStorage, output: ZiweiOutput): DivinationReadingFact[] {
  const facts: DivinationReadingFact[] = [
    { label: "命盘", value: `${output.solarDate} · 农历${output.lunarDate} · ${output.zodiac} · ${output.sign}` },
    {
      label: "四柱",
      value: [
        `${output.fourPillars.year.gan}${output.fourPillars.year.zhi}年`,
        `${output.fourPillars.month.gan}${output.fourPillars.month.zhi}月`,
        `${output.fourPillars.day.gan}${output.fourPillars.day.zhi}日`,
        `${output.fourPillars.hour.gan}${output.fourPillars.hour.zhi}时`,
      ].join(" · "),
    },
    { label: "命主身主", value: `命主${output.soul} · 身主${output.body} · ${output.fiveElement}` },
  ];

  const soulPalace = output.palaces.find((palace) => palace.name === "命宫") ?? output.palaces[0];
  if (soulPalace !== undefined) {
    const stars = [...soulPalace.majorStars, ...soulPalace.minorStars].map((star) => {
      const parts = [star.name];
      if (star.brightness !== undefined && star.brightness !== "") parts.push(`${star.brightness}`);
      if (star.mutagen !== undefined && star.mutagen !== "") parts.push(`化${star.mutagen}`);
      return parts.join("");
    });
    facts.push({
      label: "命宫",
      value: `${soulPalace.heavenlyStem}${soulPalace.earthlyBranch} · ${stars.join("、")}`,
    });
    const sanFang = soulPalace.sanFangSiZheng ?? [];
    if (sanFang.length > 0) facts.push({ label: "命宫三方四正", value: sanFang.join("、") });
  }

  const bodyPalace = output.palaces.find((palace) => palace.isBodyPalace === true);
  if (bodyPalace !== undefined) {
    facts.push({
      label: "身宫",
      value: `${bodyPalace.name}（${bodyPalace.heavenlyStem}${bodyPalace.earthlyBranch}）`,
    });
  }

  if (output.mutagenSummary !== undefined && output.mutagenSummary.length > 0) {
    facts.push({
      label: "四化",
      value: output.mutagenSummary
        .map((item) => `化${item.mutagen}：${item.starName}在${item.palaceName}`)
        .join("；"),
    });
  }
  facts.push({
    label: "排盘口径",
    value: [
      storage.gender === "female" ? "女命" : "男命",
      storage.trueSolar === true ? "真太阳时校正" : "钟表时间",
    ].join(" · "),
  });
  return facts;
}

/** 经典紫微盘十二宫格读取顺序(顺时针);中心 2×2 由 .ad-zw-center 显式占位。 */
const GRID_BRANCHES: readonly string[] = [
  "巳", "午", "未", "申",
  "辰", "酉",
  "卯", "戌",
  "寅", "丑", "子", "亥",
];

const LONGITUDE_OPTIONS: SelectOption[] = [
  { value: "116.4", label: "北京 116.4" },
  { value: "121.5", label: "上海 121.5" },
  { value: "104.1", label: "成都 104.1" },
  { value: "87.6", label: "乌鲁木齐 87.6" },
  { value: "custom", label: "自定义" },
];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

type Palace = ZiweiOutput["palaces"][number];

function renderPalaceCell(host: HTMLElement, palace: Palace, isSoul: boolean): HTMLElement {
  const doc = host.ownerDocument;
  const cell = doc.createElement("div");
  cell.className = isSoul ? "ad-zw-palace ad-zw-palace--soul" : "ad-zw-palace";
  const head = doc.createElement("div");
  head.className = "ad-zw-palace__head";
  const name = doc.createElement("strong");
  name.textContent = palace.name;
  head.append(name);
  const stemBranch = doc.createElement("span");
  stemBranch.className = "ad-zw-palace__stem";
  stemBranch.textContent = `${palace.heavenlyStem}${palace.earthlyBranch}`;
  head.append(stemBranch);
  cell.append(head);

  const range = palace.decadalRange;
  if (range !== undefined && range.length >= 2) {
    const ages = doc.createElement("span");
    ages.className = "ad-zw-palace__ages";
    ages.textContent = `${range[0]}–${range[1]} 岁`;
    cell.append(ages);
  }

  if (palace.majorStars.length === 0) {
    // 空宫是紫微的常规形态(实测 720 宫里有 118 宫无主星,约 16%),
    // 本门惯例是借对宫安星 —— 不写这一句,读者只会看到一格空白。
    const empty = doc.createElement("span");
    empty.className = "ad-zw-star ad-zw-star--empty";
    empty.textContent = "空宫（借对宫）";
    cell.append(empty);
  }
  for (const star of palace.majorStars) {
    const line = doc.createElement("span");
    line.className = "ad-zw-star ad-zw-star--major";
    // brightness/mutagen 在库里都是可选字段：缺失时是 undefined 而不是空串，
    // 只比空串会渲染出「 undefined」并给非化象星误挂化象样式。
    const brightness = star.brightness == null || star.brightness === "" ? "" : ` ${star.brightness}`;
    const mutagen = star.mutagen == null || star.mutagen === "" ? "" : ` ${star.mutagen}`;
    line.textContent = `${star.name}${brightness}${mutagen}`;
    if (mutagen !== "") line.classList.add("ad-zw-star--mutagen");
    cell.append(line);
  }
  if (palace.minorStars.length > 0) {
    const line = doc.createElement("span");
    line.className = "ad-zw-star ad-zw-star--minor";
    line.textContent = palace.minorStars.map((star) => star.name).join(" ");
    cell.append(line);
  }
  if ((palace.adjStars ?? []).length > 0) {
    const line = doc.createElement("span");
    line.className = "ad-zw-star ad-zw-star--adj";
    line.textContent = (palace.adjStars ?? []).map((star) => star.name).join(" ");
    cell.append(line);
  }
  if (palace.isBodyPalace) {
    const badge = doc.createElement("span");
    badge.className = "ad-zw-palace__badge";
    badge.textContent = "身";
    cell.append(badge);
  }
  return cell;
}

function renderResult(host: HTMLElement, storage: ZiweiStorage, reading?: ReadingSlot): void {
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

  const card = createResultCard(host, `紫微斗数 · ${output.solarDate}`);
  const body = card.body;

  const soulPalace = output.palaces.find((palace) => palace.isOriginalPalace && palace.name === "命宫")
    ?? output.palaces.find((palace) => palace.name === "命宫");

  const grid = doc.createElement("div");
  grid.className = "ad-zw-grid";
  for (const branch of GRID_BRANCHES) {
    const palace = output.palaces.find((item) => item.earthlyBranch === branch);
    if (palace === undefined) {
      const empty = doc.createElement("div");
      empty.className = "ad-zw-palace ad-zw-palace--empty";
      empty.textContent = branch;
      grid.append(empty);
      continue;
    }
    grid.append(renderPalaceCell(host, palace, palace.name === "命宫"));
  }

  // 中心信息块(占据 2×2)。
  const center = doc.createElement("div");
  center.className = "ad-zw-center";
  const centerTitle = doc.createElement("strong");
  centerTitle.textContent = `${output.fiveElement} · ${output.zodiac}`;
  const lines: string[] = [
    `命主 ${output.lifeMasterStar ?? ""}`.trim(),
    `身主 ${output.bodyMasterStar ?? ""}`.trim(),
    `斗君 ${output.douJun ?? ""}`.trim(),
    `命宫 ${output.earthlyBranchOfSoulPalace ?? ""}`.trim(),
    `身宫 ${output.earthlyBranchOfBodyPalace ?? ""}`.trim(),
  ].filter((line) => !line.endsWith(" ") && line.split(" ").length > 1);
  for (const line of lines) {
    const item = doc.createElement("span");
    item.textContent = line;
    center.append(item);
  }
  center.prepend(centerTitle);
  grid.append(center);

  const pillars = doc.createElement("p");
  pillars.className = "ad-zw-pillars";
  pillars.textContent = [
    `${output.fourPillars.year.gan}${output.fourPillars.year.zhi}`,
    `${output.fourPillars.month.gan}${output.fourPillars.month.zhi}`,
    `${output.fourPillars.day.gan}${output.fourPillars.day.zhi}`,
    `${output.fourPillars.hour.gan}${output.fourPillars.hour.zhi}`,
  ].join(" · ");
  center.append(pillars);
  body.append(grid);

  if (output.mutagenSummary !== undefined && output.mutagenSummary.length > 0) {
    const chips = doc.createElement("div");
    chips.className = "ad-bp-chips";
    for (const item of output.mutagenSummary) {
      chips.append(createChip(host, `${item.mutagen} ${item.starName}@${item.palaceName}`, true));
    }
    body.append(chips);
  }

  const sanfang = soulPalace?.sanFangSiZheng ?? [];
  if (sanfang.length > 0) {
    const line = doc.createElement("p");
    line.className = "ad-ly-line ad-ly-line--muted";
    line.textContent = `命宫三方四正：${sanfang.join("、")}`;
    body.append(line);
  }

  reading?.paintInto(card.body);
  holder.append(card.root);
  host.replaceChildren(holder);
}

/** 紫微斗数:出生信息安星,12 宫盘按地支宫位渲染,中心块放命局摘要。 */
export const ziweiPanel: BusiPanel = {
  id: "ziwei",
  label: "紫微",
  render(host, storage, ctx) {
    const raw = storage as ZiweiStorage;
    const now = new Date();
    const birthDate = raw.birthDate ?? `${now.getFullYear()}-01-01`;
    const birthTime = raw.birthTime ?? "10:00";
    const gender = raw.gender ?? "male";
    const trueSolar = raw.trueSolar ?? false;
    const longitudeChoice = raw.longitudeChoice ?? "116.4";

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
    const trueSolarControl = createCheckboxField(host, "真太阳时", trueSolar);
    const longitudeSelect = createSelectField(host, "参考经度", LONGITUDE_OPTIONS, longitudeChoice);
    const longitudeWrap = createField(host, "参考经度", longitudeSelect);
    const customLongitudeInput = doc.createElement("input");
    customLongitudeInput.type = "number";
    customLongitudeInput.className = "ad-bp-input";
    customLongitudeInput.step = "0.1";
    customLongitudeInput.min = "73";
    customLongitudeInput.max = "135";
    customLongitudeInput.placeholder = "经度 73–135";
    customLongitudeInput.setAttribute("aria-label", "自定义经度");
    customLongitudeInput.value = raw.customLongitude === undefined ? "" : String(raw.customLongitude);
    const customWrap = createField(host, "自定义经度", customLongitudeInput);
    /** 真太阳时开关 + 经度来源共同决定两个字段的显隐(选「自定义」必须给输入框)。 */
    const syncLongitudeVisibility = (): void => {
      const enabled = trueSolarControl.input.checked;
      longitudeWrap.style.display = enabled ? "" : "none";
      customWrap.style.display = enabled && longitudeSelect.value === "custom" ? "" : "none";
    };
    syncLongitudeVisibility();
    trueSolarControl.input.addEventListener("change", () => {
      raw.trueSolar = trueSolarControl.input.checked;
      syncLongitudeVisibility();
    });
    longitudeSelect.addEventListener("change", () => {
      raw.longitudeChoice = longitudeSelect.value;
      syncLongitudeVisibility();
    });

    const resultHost = doc.createElement("div");
    resultHost.className = "ad-bp-panel__result-host";
    const reading = createReadingSlot({
      host,
      storage: raw,
      ctx,
      build: () => (raw.result === undefined ? null : {
        kind: "method" as const,
        method: "ziwei",
        // 排盘是纯函数:同一组出生信息(含折算后的经度)必得同一盘。
        cacheKey: [
          raw.birthDate ?? "",
          raw.birthTime ?? "",
          raw.gender ?? "male",
          raw.trueSolar === true ? `${raw.longitudeChoice ?? ""}:${raw.customLongitude ?? ""}` : "",
        ].join("|"),
        momentText: raw.birthDate ?? "",
        question: "",
        facts: readingFactsOf(raw, raw.result),
      }),
    });

    const submit = createSubmitButton(host, "安星排盘", () => {
      raw.birthDate = dateInput.value;
      raw.birthTime = timeInput.value;
      raw.trueSolar = trueSolarControl.input.checked;
      raw.longitudeChoice = longitudeSelect.value;
      if (customLongitudeInput.value.trim() !== "") {
        const parsed = Number(customLongitudeInput.value);
        if (Number.isFinite(parsed)) raw.customLongitude = parsed;
      }
      const dateMatch = DATE_PATTERN.exec(dateInput.value);
      const timeMatch = TIME_PATTERN.exec(timeInput.value);
      if (dateMatch === null || timeMatch === null) {
        raw.error = "请填写完整的出生日期与时间";
        raw.result = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      // 自定义经度只在库侧报错(「longitude 必须是 -180 到 180」),面板按常用范围先拦。
      if (raw.trueSolar === true && longitudeSelect.value === "custom") {
        const longitude = raw.customLongitude;
        if (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < 73 || longitude > 135) {
          raw.error = "经度取 73–135";
          raw.result = undefined;
          renderResult(resultHost, raw, reading);
          return;
        }
      }
      raw.error = undefined;
      raw.result = undefined;
      // 上一张命盘的解卦不跟着新盘走。
      raw.reading = undefined;
      renderResult(resultHost, raw, reading);
      const input: ZiweiInput = {
        birthYear: Number(dateMatch[1]),
        birthMonth: Number(dateMatch[2]),
        birthDay: Number(dateMatch[3]),
        birthHour: Number(timeMatch[1]),
        birthMinute: Number(timeMatch[2]),
        gender: raw.gender ?? "male",
      };
      if (raw.trueSolar) {
        const choice = longitudeSelect.value;
        if (choice === "custom") {
          if (typeof raw.customLongitude === "number") input.longitude = raw.customLongitude;
        } else {
          input.longitude = Number(choice);
        }
      }
      const requests = requestTokenFor(raw);
      const token = requests.next();
      void (async () => {
        try {
          const output = await Promise.resolve(calculateZiwei(input));
          // 连点两次排盘时，先发起的那次结果不许再写回。
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
      createField(host, "出生日期", dateInput),
      createField(host, "出生时间", timeInput),
      createField(host, "性别", genderSegmented.root),
      trueSolarControl.wrap,
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
    const raw = storage as ZiweiStorage;
    const birthDate = readInputValue(host, "出生日期");
    const birthTime = readInputValue(host, "出生时间");
    const gender = readSegmentedValue(host, "性别");
    const trueSolar = readCheckboxValue(host, "真太阳时");
    const longitudeChoice = readInputValue(host, "参考经度");
    const customLongitude = readNumberValue(host, "自定义经度");
    if (birthDate !== undefined) raw.birthDate = birthDate;
    if (birthTime !== undefined) raw.birthTime = birthTime;
    if (gender === "male" || gender === "female") raw.gender = gender;
    if (trueSolar !== undefined) raw.trueSolar = trueSolar;
    if (longitudeChoice !== undefined) raw.longitudeChoice = longitudeChoice;
    if (customLongitude !== undefined) raw.customLongitude = customLongitude;
  },
};
