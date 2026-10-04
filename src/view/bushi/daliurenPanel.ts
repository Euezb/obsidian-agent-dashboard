import { calculateDaliuren } from "taibu-core/daliuren";
import type { DaliurenOutput } from "taibu-core/daliuren";
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
  createSubmitButton,
  createTextField,
  nowLocalInputValue,
  readInputValue,
  systemTimeZone,
  toCoreDateTime,
} from "./bushiUi";

interface DlrStorage {
  dateValue?: string;
  question?: string;
  result?: DaliurenOutput;
  error?: string;
  /** 解卦:跟着 result 走,重新起一课就重置。缓存在服务里,这里只存状态。 */
  reading?: ReadingSlotState;
}

const BRANCH_ORDER: readonly string[] = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

/** 三传是天大六壬的骨架,四课与课体是背景;这三样进事实行,其余由模型按断法取用。 */
function readingFactsOf(result: DaliurenOutput): DivinationReadingFact[] {
  const facts: DivinationReadingFact[] = [];
  const { dateInfo, sanChuan, siKe } = result;
  facts.push({
    label: "起课",
    value: `${dateInfo.solarDate} · ${dateInfo.ganZhi.day}日 · ${dateInfo.yueJiangName}月将`,
  });
  facts.push({ label: "课体", value: [result.keName, result.keTi.method, ...result.keTi.subTypes].join(" · ") });
  const chuan = (name: string, item: readonly string[] | undefined): void => {
    if (item === undefined) return;
    facts.push({ label: name, value: item.filter((part) => part !== "").join(" · ") });
  };
  chuan("初传", sanChuan.chu);
  chuan("中传", sanChuan.zhong);
  chuan("末传", sanChuan.mo);
  facts.push({
    label: "四课",
    value: [siKe.yiKe, siKe.erKe, siKe.sanKe, siKe.siKe]
      .map((ke) => ke.filter((part) => part !== "").join("/"))
      .join("；"),
  });
  facts.push({ label: "旬空", value: dateInfo.kongWang.join("、") });
  if (result.shenSha.length > 0) {
    facts.push({ label: "神煞", value: result.shenSha.map((item) => item.name).join("、") });
  }
  return facts;
}

function renderResult(host: HTMLElement, storage: DlrStorage, reading?: ReadingSlot): void {
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

  const card = createResultCard(host, `大六壬 · ${output.keName}`);
  const body = card.body;

  const info = output.dateInfo;
  const meta = doc.createElement("p");
  meta.className = "ad-dlr-meta";
  meta.textContent = [
    info.bazi,
    `月将 ${info.yueJiang}${info.yueJiangName}`,
    `旬 ${info.xun}（空${info.kongWang.join("")}）`,
    `驿马 ${info.yiMa}`,
    info.diurnal ? "昼占" : "夜占",
  ].filter((part) => part !== "").join(" · ");
  body.append(meta);

  // 天地盘:3×4 十二宫格,每格地盘+天盘+天将+遁干+长生建除。
  const pan = doc.createElement("div");
  pan.className = "ad-dlr-pan";
  for (const branch of BRANCH_ORDER) {
    const gong = output.gongInfos.find((item) => item.diZhi === branch);
    const cell = doc.createElement("div");
    cell.className = "ad-dlr-pan__cell";
    const di = doc.createElement("span");
    di.className = "ad-dlr-pan__di";
    di.textContent = gong?.diZhi ?? branch;
    const tian = doc.createElement("span");
    tian.className = "ad-dlr-pan__tian";
    tian.textContent = gong?.tianZhi ?? "";
    const jiang = doc.createElement("span");
    jiang.className = "ad-dlr-pan__jiang";
    jiang.textContent = gong?.tianJiangShort ?? "";
    const small = doc.createElement("span");
    small.className = "ad-dlr-pan__small";
    small.textContent = gong === undefined ? "" : `${gong.dunGan}${gong.changSheng}·${gong.jianChu}·${gong.wangShuai}`;
    cell.append(di, tian, jiang, small);
    cell.title = gong === undefined ? branch : `地盘${gong.diZhi} 天盘${gong.tianZhi} ${gong.tianJiang} 遁干${gong.dunGan} ${gong.changSheng}(${gong.wuXing}·${gong.wangShuai}) ${gong.jianChu}`;
    pan.append(cell);
  }
  body.append(pan);

  // 四课。
  const ke = doc.createElement("div");
  ke.className = "ad-dlr-ke";
  const keHeading = doc.createElement("p");
  keHeading.className = "ad-ly-relations__heading";
  keHeading.textContent = "四课";
  ke.append(keHeading);
  const keRow = doc.createElement("div");
  keRow.className = "ad-dlr-ke__row";
  const keLabels: ReadonlyArray<readonly [keyof DaliurenOutput["siKe"], string]> = [
    ["yiKe", "一课"], ["erKe", "二课"], ["sanKe", "三课"], ["siKe", "四课"],
  ];
  for (const [key, label] of keLabels) {
    const entry = output.siKe[key];
    const item = doc.createElement("div");
    item.className = "ad-dlr-ke__item";
    const labelElement = doc.createElement("span");
    labelElement.className = "ad-dlr-ke__label";
    labelElement.textContent = label;
    const value = doc.createElement("strong");
    value.textContent = entry[0] ?? "";
    const jiang = doc.createElement("span");
    jiang.className = "ad-dlr-ke__jiang";
    jiang.textContent = entry[1] ?? "";
    item.append(labelElement, value, jiang);
    keRow.append(item);
  }
  ke.append(keRow);
  body.append(ke);

  // 三传链:初传 → 中传 → 末传。
  const chuan = doc.createElement("div");
  chuan.className = "ad-dlr-chuan";
  const chuanHeading = doc.createElement("p");
  chuanHeading.className = "ad-ly-relations__heading";
  chuanHeading.textContent = `三传（${output.sanChuan.method}）`;
  chuan.append(chuanHeading);
  const chain = doc.createElement("div");
  chain.className = "ad-dlr-chuan__chain";
  const steps: ReadonlyArray<readonly [readonly string[], string]> = [
    [output.sanChuan.chu, "初传"],
    [output.sanChuan.zhong, "中传"],
    [output.sanChuan.mo, "末传"],
  ];
  steps.forEach(([entry, label], index) => {
    const step = doc.createElement("div");
    step.className = "ad-dlr-chuan__step";
    const labelElement = doc.createElement("span");
    labelElement.className = "ad-dlr-chuan__label";
    labelElement.textContent = label;
    const zhi = doc.createElement("strong");
    zhi.className = "ad-dlr-chuan__zhi";
    zhi.textContent = entry[0] ?? "";
    const jiang = doc.createElement("span");
    jiang.className = "ad-dlr-chuan__jiang";
    jiang.textContent = entry[1] ?? "";
    const liuqin = doc.createElement("span");
    liuqin.className = "ad-dlr-chuan__liuqin";
    liuqin.textContent = entry[2] ?? "";
    step.append(labelElement, zhi, jiang, liuqin);
    chain.append(step);
    if (index < steps.length - 1) {
      const arrow = doc.createElement("span");
      arrow.className = "ad-dlr-chuan__arrow";
      arrow.textContent = "→";
      chain.append(arrow);
    }
  });
  chuan.append(chain);
  body.append(chuan);

  // 课体与神煞。
  const keTiChips = doc.createElement("div");
  keTiChips.className = "ad-bp-chips";
  keTiChips.append(createChip(host, `课体 ${output.keTi.method}`));
  for (const subtype of output.keTi.subTypes) keTiChips.append(createChip(host, subtype));
  for (const extra of output.keTi.extraTypes) keTiChips.append(createChip(host, extra));
  body.append(keTiChips);

  if (output.shenSha.length > 0) {
    const shenSha = doc.createElement("p");
    shenSha.className = "ad-ly-line ad-ly-line--muted";
    shenSha.textContent = `神煞：${output.shenSha.map((item) => `${item.name} ${item.value}`).join(" · ")}`;
    body.append(shenSha);
  }

  reading?.paintInto(card.body);
  holder.append(card.root);
  host.replaceChildren(holder);
}

/** 大六壬:时间起课,天地盘十二宫格 + 四课 + 三传链。 */
export const daliurenPanel: BusiPanel = {
  id: "daliuren",
  label: "大六壬",
  render(host, storage, ctx) {
    const raw = storage as DlrStorage;
    const now = new Date();
    host.replaceChildren();
    const form = host.ownerDocument.createElement("form");
    form.className = "ad-bp-form";
    form.addEventListener("submit", (event) => event.preventDefault());

    const dateInput = host.ownerDocument.createElement("input");
    dateInput.type = "datetime-local";
    dateInput.value = raw.dateValue ?? nowLocalInputValue(now);
    dateInput.className = "ad-bp-input";
    dateInput.setAttribute("aria-label", "起课时间");
    const questionInput = createTextField(host, "占问(可选)", raw.question ?? "", "所问何事", true);

    const resultHost = host.ownerDocument.createElement("div");
    resultHost.className = "ad-bp-panel__result-host";
    const reading = createReadingSlot({
      host,
      storage: raw,
      ctx,
      build: () => (raw.result === undefined ? null : {
        kind: "method" as const,
        method: "daliuren",
        // 盘面由起课时刻(含分)唯一决定;问题只影响提示词,不影响课体。
        // 键要涵盖全部输入：漏掉问事文本时，只改问题重起同一课会命中旧解卦。
        cacheKey: `${raw.dateValue ?? ""}|${systemTimeZone()}|${raw.question ?? ""}`,
        momentText: raw.dateValue ?? "",
        question: raw.question ?? "",
        facts: readingFactsOf(raw.result),
      }),
    });

    const submit = createSubmitButton(host, "起课", () => {
      raw.dateValue = dateInput.value;
      raw.question = questionInput.value;
      const coreDate = toCoreDateTime(dateInput.value);
      if (coreDate === null) {
        raw.error = "起课时间不合法";
        raw.result = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      raw.error = undefined;
      raw.result = undefined;
      // 上一课的解卦不跟着新课走。
      raw.reading = undefined;
      renderResult(resultHost, raw, reading);
      const [date, time] = coreDate.split("T");
      if (date === undefined || time === undefined) {
        raw.error = "起课时间不合法";
        renderResult(resultHost, raw, reading);
        return;
      }
      const hour = Number(time.slice(0, 2));
      const minute = Number(time.slice(3, 5));
      const requests = requestTokenFor(raw);
      const token = requests.next();
      void (async () => {
        try {
          const output = await Promise.resolve(calculateDaliuren({
            date,
            hour,
            minute,
            timezone: systemTimeZone(),
            question: raw.question === "" ? undefined : raw.question,
          }));
          // 连点两次起课时，先发起的那次结果不许再写回。
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
      createField(host, "起课时间", dateInput),
      createField(host, "占问(可选)", questionInput, true),
      submit,
    );
    host.append(form);
    host.append(resultHost);
    renderResult(resultHost, raw, reading);

    return () => {
      host.replaceChildren();
    };
  },
  harvest(host, storage) {
    const raw = storage as DlrStorage;
    const dateValue = readInputValue(host, "起课时间");
    const question = readInputValue(host, "占问(可选)");
    if (dateValue !== undefined) raw.dateValue = dateValue;
    if (question !== undefined) raw.question = question;
  },
};
