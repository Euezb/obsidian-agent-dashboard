import { calculateBazi, calculateBaziFiveElementsStats } from "taibu-core/bazi";
import type { BaziInput, BaziOutput } from "taibu-core/bazi";
import type { BusiPanel } from "../../features/divination/bushiTypes";
import { pillarRelations, summarizeRelations } from "../../features/divination/relations";
import type { DivinationReadingFact } from "../../features/divination/divinationReading";
import { createReadingSlot, type ReadingSlot, type ReadingSlotState } from "./readingSlot";
import { requestTokenFor } from "./panelToken";
import {
  collectError,
  createChip,
  createPanelNotice,
  createResultCard,
  createSegmented,
  createSubmitButton,
  readInputValue,
  readSegmentedValue,
} from "./bushiUi";

interface BirthForm {
  birthDate?: string;
  birthTime?: string;
  gender?: "male" | "female";
}

interface HepanStorage {
  a?: BirthForm;
  b?: BirthForm;
  resultA?: BaziOutput;
  resultB?: BaziOutput;
  error?: string;
  /** 解卦:跟着两个 result 走,重新合盘就重置。缓存在服务里,这里只存状态。 */
  reading?: ReadingSlotState;
}

/** 一方的事实行:日主、日柱与月令是看两个人相处的三个锚点。 */
function sideFacts(label: string, form: BirthForm | undefined, result: BaziOutput): DivinationReadingFact[] {
  const fourPillars = [
    `${result.fourPillars.year.stem}${result.fourPillars.year.branch}`,
    `${result.fourPillars.month.stem}${result.fourPillars.month.branch}`,
    `${result.fourPillars.day.stem}${result.fourPillars.day.branch}`,
    `${result.fourPillars.hour.stem}${result.fourPillars.hour.branch}`,
  ].join(" ");
  return [
    {
      label,
      value: [
        fourPillars,
        `日主${result.dayMaster}`,
        form?.gender === "female" ? "女命" : "男命",
        result.fourPillars.month.tenGod === undefined || result.fourPillars.month.tenGod === ""
          ? ""
          : `月令${result.fourPillars.month.tenGod}`,
      ].filter((part) => part !== "").join(" · "),
    },
  ];
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/** 窄格里的单字柱名(关系 chip 用的是「年柱」这类完整标签,来自关系模块)。 */
const PILLAR_SHORT: ReadonlyArray<readonly [keyof BaziOutput["fourPillars"], string]> = [
  ["year", "年"],
  ["month", "月"],
  ["day", "日"],
  ["hour", "时"],
];

function renderMiniPillars(host: HTMLElement, output: BaziOutput, title: string): HTMLElement {
  const doc = host.ownerDocument;
  const block = doc.createElement("div");
  block.className = "ad-hp-side";
  const heading = doc.createElement("p");
  heading.className = "ad-ly-relations__heading";
  heading.textContent = title;
  block.append(heading);
  const row = doc.createElement("div");
  row.className = "ad-hp-pillars";
  for (const [key, label] of PILLAR_SHORT) {
    const pillar = output.fourPillars[key];
    if (pillar === undefined) continue;
    const cell = doc.createElement("div");
    cell.className = key === "day" ? "ad-hp-pillar ad-hp-pillar--day" : "ad-hp-pillar";
    const name = doc.createElement("span");
    name.className = "ad-hp-pillar__label";
    name.textContent = label;
    const gz = doc.createElement("strong");
    gz.textContent = `${pillar.stem}${pillar.branch}`;
    cell.append(name, gz);
    row.append(cell);
  }
  block.append(row);
  return block;
}

function renderResult(host: HTMLElement, storage: HepanStorage, reading?: ReadingSlot): void {
  const doc = host.ownerDocument;
  const holder = doc.createElement("div");
  holder.className = "ad-bp-panel__result";
  if (storage.error !== undefined) {
    holder.append(createPanelNotice(host, "error", storage.error));
    host.replaceChildren(holder);
    return;
  }
  const a = storage.resultA;
  const b = storage.resultB;
  if (a === undefined || b === undefined) {
    // 首次打开面板时这里本来是整块空白 —— 空白与「坏了」分不出来。
    holder.append(createPanelNotice(host, "empty", "填好双方的出生日期与时间后点「合盘」，这里给出四柱、柱间关系与五行互补。"));
    host.replaceChildren(holder);
    return;
  }

  const card = createResultCard(host, "八字合盘");
  const body = card.body;

  const sides = doc.createElement("div");
  sides.className = "ad-hp-sides";
  sides.append(renderMiniPillars(host, a, "甲方"), renderMiniPillars(host, b, "乙方"));
  body.append(sides);

  const hits = pillarRelations(a, b);
  if (hits.length > 0) {
    const section = doc.createElement("div");
    section.className = "ad-hp-relations";
    const heading = doc.createElement("p");
    heading.className = "ad-ly-relations__heading";
    heading.textContent = "柱间关系";
    section.append(heading);
    const chips = doc.createElement("div");
    chips.className = "ad-bp-chips";
    for (const hit of hits) {
      const element = createChip(host, `${hit.position} ${hit.kind}:${hit.detail}`, hit.tone === "good");
      if (hit.tone === "warn") element.classList.add("ad-bp-chip--warn");
      chips.append(element);
    }
    section.append(chips);
    body.append(section);
  }

  const statsA = calculateBaziFiveElementsStats(a.fourPillars);
  const statsB = calculateBaziFiveElementsStats(b.fourPillars);
  const keys: ReadonlyArray<"金" | "木" | "水" | "火" | "土"> = ["金", "木", "水", "火", "土"];
  const stats = doc.createElement("div");
  stats.className = "ad-hp-stats";
  const heading = doc.createElement("p");
  heading.className = "ad-ly-relations__heading";
  heading.textContent = "五行互补（上=甲，下=乙）";
  stats.append(heading);
  for (const key of keys) {
    const row = doc.createElement("div");
    row.className = "ad-hp-stats__row";
    const label = doc.createElement("span");
    label.textContent = key;
    const barA = doc.createElement("span");
    barA.className = "ad-hp-stats__bar ad-hp-stats__bar--a";
    barA.style.width = `${Math.min(100, (statsA[key] ?? 0) * 14)}%`;
    barA.title = `甲方 ${statsA[key] ?? 0}`;
    const barB = doc.createElement("span");
    barB.className = "ad-hp-stats__bar ad-hp-stats__bar--b";
    barB.style.width = `${Math.min(100, (statsB[key] ?? 0) * 14)}%`;
    barB.title = `乙方 ${statsB[key] ?? 0}`;
    row.append(label, barA, barB);
    stats.append(row);
  }
  body.append(stats);

  const verdict = doc.createElement("p");
  verdict.className = "ad-ly-line";
  verdict.textContent = summarizeRelations(hits).verdict;
  body.append(verdict);

  reading?.paintInto(card.body);
  holder.append(card.root);
  host.replaceChildren(holder);
}

function buildInput(form: BirthForm | undefined): BaziInput | null {
  if (form === undefined) return null;
  const dateMatch = DATE_PATTERN.exec(form.birthDate ?? "");
  const timeMatch = TIME_PATTERN.exec(form.birthTime ?? "");
  if (dateMatch === null || timeMatch === null) return null;
  return {
    birthYear: Number(dateMatch[1]),
    birthMonth: Number(dateMatch[2]),
    birthDay: Number(dateMatch[3]),
    birthHour: Number(timeMatch[1]),
    birthMinute: Number(timeMatch[2]),
    gender: form.gender ?? "male",
  };
}

interface SideControls {
  wrap: HTMLElement;
  read: () => BirthForm;
  /** 性别 segmented 的清理句柄：它挂了 document 级监听，卸载时必须显式回收。 */
  control: { cleanup: () => void };
}

/**
 * 八字合盘:双方四柱 + 同位置柱间关系(五合/六合/半合/相生/冲克,方向已写明)+ 五行互补。
 * 关系判定全部走 `features/divination/relations`(纯函数,可单测):
 * 半合要求两支不同、相生相克双向判定、五合命中后不再报相克,日主不再重复计算。
 */
export const hepanPanel: BusiPanel = {
  id: "hepan",
  label: "八字合盘",
  render(host, storage, ctx) {
    const raw = storage as HepanStorage;
    const now = new Date();
    host.replaceChildren();
    const doc = host.ownerDocument;
    const form = doc.createElement("form");
    form.className = "ad-bp-form";
    form.addEventListener("submit", (event) => event.preventDefault());

    const makeSide = (side: BirthForm | undefined, name: string): SideControls => {
      const wrap = doc.createElement("div");
      wrap.className = "ad-hp-side-form";
      const heading = doc.createElement("span");
      heading.className = "ad-bp-field__label";
      heading.textContent = name;
      wrap.append(heading);

      const date = doc.createElement("input");
      date.type = "date";
      date.value = side?.birthDate ?? `${now.getFullYear()}-01-01`;
      date.className = "ad-bp-input";
      date.setAttribute("aria-label", `${name}出生日期`);
      const time = doc.createElement("input");
      time.type = "time";
      time.value = side?.birthTime ?? "10:00";
      time.className = "ad-bp-input";
      time.setAttribute("aria-label", `${name}出生时间`);
      const genderControl = createSegmented(
        host,
        [
          { value: "male", label: "男" },
          { value: "female", label: "女" },
        ],
        side?.gender ?? "male",
        () => undefined,
        `${name}性别`,
      );
      wrap.append(date, time, genderControl.root);
      const read = (): BirthForm => {
        const pressed = genderControl.root.querySelector('[aria-pressed="true"]');
        const gender = pressed?.getAttribute("data-value") === "female" ? "female" : "male";
        return { birthDate: date.value, birthTime: time.value, gender };
      };
      return { wrap, read, control: genderControl };
    };

    const sideA = makeSide(raw.a, "甲方");
    const sideB = makeSide(raw.b, "乙方");

    const resultHost = doc.createElement("div");
    resultHost.className = "ad-bp-panel__result-host";
    const reading = createReadingSlot({
      host,
      storage: raw,
      ctx,
      build: () => (raw.resultA === undefined || raw.resultB === undefined ? null : {
        kind: "method" as const,
        method: "hepan",
        cacheKey: [
          raw.a?.birthDate ?? "", raw.a?.birthTime ?? "", raw.a?.gender ?? "",
          raw.b?.birthDate ?? "", raw.b?.birthTime ?? "", raw.b?.gender ?? "",
        ].join("|"),
        momentText: raw.a?.birthDate ?? "",
        question: "",
        facts: [
          ...sideFacts("甲方", raw.a, raw.resultA),
          ...sideFacts("乙方", raw.b, raw.resultB),
        ],
      }),
    });

    const submit = createSubmitButton(host, "合盘", () => {
      raw.a = sideA.read();
      raw.b = sideB.read();
      const inputA = buildInput(raw.a);
      const inputB = buildInput(raw.b);
      if (inputA === null || inputB === null) {
        raw.error = "双方的出生日期与时间都需要填写完整";
        raw.resultA = undefined;
        raw.resultB = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      raw.error = undefined;
      raw.resultA = undefined;
      raw.resultB = undefined;
      // 上一张合盘的解卦不跟着新盘走。
      raw.reading = undefined;
      renderResult(resultHost, raw, reading);
      const requests = requestTokenFor(raw);
      const token = requests.next();
      void (async () => {
        try {
          const [resultA, resultB] = await Promise.all([
            Promise.resolve(calculateBazi(inputA)),
            Promise.resolve(calculateBazi(inputB)),
          ]);
          // 连点两次合盘时，先发起的那次结果不许再写回。
          if (!requests.isCurrent(token)) return;
          raw.resultA = resultA;
          raw.resultB = resultB;
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

    form.append(sideA.wrap, sideB.wrap, submit);
    host.append(form);
    host.append(resultHost);
    renderResult(resultHost, raw, reading);

    return () => {
      // 两个性别 segmented 各自挂了 document 级监听，必须显式清理
      // （bushiTypes 的清理契约；对照 taiyiPanel 的 modeSegmented.cleanup()）。
      sideA.control.cleanup();
      sideB.control.cleanup();
      host.replaceChildren();
    };
  },
  harvest(host, storage) {
    const raw = storage as HepanStorage;
    const readSide = (name: string, existing: BirthForm | undefined): BirthForm => {
      const birthDate = readInputValue(host, `${name}出生日期`);
      const birthTime = readInputValue(host, `${name}出生时间`);
      const gender = readSegmentedValue(host, `${name}性别`);
      return {
        birthDate: birthDate ?? existing?.birthDate,
        birthTime: birthTime ?? existing?.birthTime,
        gender: gender === "female" ? "female" : gender === "male" ? "male" : existing?.gender,
      };
    };
    raw.a = readSide("甲方", raw.a);
    raw.b = readSide("乙方", raw.b);
  },
};
