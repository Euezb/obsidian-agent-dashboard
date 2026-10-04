import { calculateLiuyao } from "taibu-core/liuyao";
import type { LiuQinType, LiuyaoOutput } from "taibu-core/liuyao";
import { HEXAGRAMS } from "taibu-core/data/hexagrams";
import type { BusiPanel } from "../../features/divination/bushiTypes";
import type { DivinationReadingFact, DivinationReadingRequest } from "../../features/divination/divinationReading";
import { createReadingSlot, type ReadingSlot, type ReadingSlotState } from "./readingSlot";
import { requestTokenFor } from "./panelToken";
import {
  collectError,
  createChip,
  createField,
  createNumberField,
  createPanelNotice,
  createResultCard,
  createSegmented,
  createSelectField,
  createSubmitButton,
  createTextField,
  nowLocalInputValue,
  readInputValue,
  readNumberValue,
  readSegmentedValue,
  toCoreDateTime,
  type SelectOption,
} from "./bushiUi";

type LiuqinTypeName = LiuQinType;

type FullYao = LiuyaoOutput["fullYaos"][number];

const LIUQIN_OPTIONS: ReadonlyArray<{ value: LiuqinTypeName; label: string }> = [
  { value: "父母", label: "父母" },
  { value: "兄弟", label: "兄弟" },
  { value: "子孙", label: "子孙" },
  { value: "妻财", label: "妻财" },
  { value: "官鬼", label: "官鬼" },
];

const METHODS: ReadonlyArray<SelectOption> = [
  { value: "auto", label: "自动摇卦" },
  { value: "time", label: "时间起卦" },
  { value: "number", label: "数字起卦" },
  { value: "select", label: "手动选卦" },
];

const YAO_NAMES: readonly string[] = ["初爻", "二爻", "三爻", "四爻", "五爻", "上爻"];

const WANG_SHUAI_LABELS: Record<string, string> = {
  wang: "旺", xiang: "相", xiu: "休", qiu: "囚", si: "死",
};

interface LiuyaoStorage {
  question?: string;
  method?: string;
  dateValue?: string;
  numbers?: [number, number, number];
  hexagramName?: string;
  changedHexagramName?: string;
  yongShenTargets?: LiuqinTypeName[];
  result?: LiuyaoOutput;
  error?: string;
  /** 解卦:跟着 result 走,重新起一卦就重置。缓存在服务里,这里只存状态。 */
  reading?: ReadingSlotState;
}

/** 解卦请求:卦名、用神与动爻是断卦的骨,六亲明细太多,只挑带动的与世应。 */
function readingRequestOf(storage: LiuyaoStorage, result: LiuyaoOutput): DivinationReadingRequest {
  const facts: DivinationReadingFact[] = [
    { label: "本卦", value: `${result.hexagramName}（${result.hexagramGong}宫 · 属${result.hexagramElement}）` },
  ];
  if (result.changedHexagramName !== undefined && result.changedHexagramName !== "") {
    facts.push({ label: "变卦", value: result.changedHexagramName });
  }
  const askedYongShen = result.yongShen
    .map((group) => {
      const chosen = group.selected;
      return `${group.targetLiuQin}（${[
        chosen.naJia ?? "",
        chosen.movementLabel,
        chosen.strengthLabel,
      ].filter((part) => part !== "").join(" · ")}）`;
    })
    .join("；");
  if (askedYongShen !== "") facts.push({ label: "用神", value: askedYongShen });

  const moving = result.fullYaos
    .filter((yao) => yao.isChanging || yao.changedYao !== null)
    .map((yao) => {
      const name = YAO_NAMES[yao.position - 1] ?? `第${yao.position}爻`;
      const changed = yao.changedYao;
      return [
        `${name} ${yao.liuQin}${yao.naJia}`,
        yao.isShiYao ? "（世）" : yao.isYingYao ? "（应）" : "",
        `（${yao.movementLabel}）`,
        changed === null ? "" : ` → ${changed.liuQin}${changed.naJia ?? ""}`,
      ].join("");
    });
  facts.push({ label: "动爻", value: moving.length === 0 ? "六爻安静，无动爻" : moving.join("；") });
  facts.push({
    label: "四柱与旬空",
    value: `${result.ganZhiTime.year.gan}${result.ganZhiTime.year.zhi}年 · ${result.ganZhiTime.month.gan}${result.ganZhiTime.month.zhi}月 · ${result.ganZhiTime.day.gan}${result.ganZhiTime.day.zhi}日 · ${result.ganZhiTime.hour.gan}${result.ganZhiTime.hour.zhi}时 · 旬空${result.kongWang.kongDizhi.join("、")}`,
  });
  if (result.guaCi !== undefined && result.guaCi !== "") {
    facts.push({ label: "卦辞", value: result.guaCi });
  }
  if (result.globalShenSha.length > 0) {
    facts.push({ label: "神煞", value: result.globalShenSha.join("、") });
  }
  return {
    kind: "method",
    method: "liuyao",
    // 库在 auto 方式下回填 seed;其余方式用起卦输入拼一把,同一卦不重取。
    // 问事文本也在键里：只改问题重起同一卦时要重新解卦，不能命中旧文本。
    cacheKey: result.seed ?? [
      storage.method ?? "",
      storage.dateValue ?? "",
      storage.numbers?.join(",") ?? "",
      storage.hexagramName ?? "",
      storage.changedHexagramName ?? "",
      (storage.yongShenTargets ?? []).join(","),
      storage.question ?? "",
    ].join("|"),
    momentText: storage.dateValue ?? "",
    question: storage.question ?? "",
    facts,
  };
}

function hexagramOptions(): SelectOption[] {
  return HEXAGRAMS.map((item) => ({ value: item.name, label: item.name }));
}

function changedOptions(): SelectOption[] {
  return [{ value: "", label: "无变卦" }, ...hexagramOptions()];
}

/** 一根爻线:阳爻整线,阴爻断线。 */
function renderYaoLine(host: HTMLElement, yin: boolean): HTMLElement {
  const line = host.ownerDocument.createElement("span");
  line.className = yin ? "ad-ly-yao__line ad-ly-yao__line--yin" : "ad-ly-yao__line";
  return line;
}

function renderYaoRow(
  host: HTMLElement,
  yao: LiuyaoOutput["fullYaos"][number],
  isChanged: boolean,
): HTMLElement {
  const doc = host.ownerDocument;
  const row = doc.createElement("div");
  row.className = "ad-ly-yao";

  const name = doc.createElement("span");
  name.className = "ad-ly-yao__name";
  name.textContent = YAO_NAMES[yao.position - 1] ?? String(yao.position);
  row.append(name, renderYaoLine(host, yao.type === 0));

  const info = doc.createElement("span");
  info.className = "ad-ly-yao__info";
  info.textContent = `${yao.liuQin}${yao.naJia}${yao.wuXing}`;
  row.append(info);

  const marks = doc.createElement("span");
  marks.className = "ad-ly-yao__marks";
  if (yao.isShiYao) {
    const shi = doc.createElement("em");
    shi.className = "ad-ly-mark ad-ly-mark--shi";
    shi.textContent = "世";
    marks.append(shi);
  }
  if (yao.isYingYao) {
    const ying = doc.createElement("em");
    ying.className = "ad-ly-mark ad-ly-mark--ying";
    ying.textContent = "应";
    marks.append(ying);
  }
  if (!isChanged && yao.isChanging) {
    const moving = doc.createElement("em");
    moving.className = "ad-ly-mark ad-ly-mark--moving";
    moving.textContent = "动";
    marks.append(moving);
  }
  if (isChanged) {
    const changed = doc.createElement("em");
    changed.className = "ad-ly-mark ad-ly-mark--changed";
    changed.textContent = "变";
    marks.append(changed);
  }
  if (yao.kongWangState === "kong_static") {
    const kong = doc.createElement("em");
    kong.className = "ad-ly-mark ad-ly-mark--kong";
    kong.textContent = "空";
    marks.append(kong);
  }
  row.append(marks);

  const strength = doc.createElement("span");
  strength.className = "ad-ly-yao__strength";
  strength.textContent = yao.strength === undefined
    ? ""
    : WANG_SHUAI_LABELS[yao.strength.wangShuai] ?? yao.strength.wangShuai;
  row.append(strength);
  return row;
}

function renderChartColumn(
  host: HTMLElement,
  title: string,
  meta: string,
  yaos: LiuyaoOutput["fullYaos"],
  changed: boolean,
): HTMLElement {
  const doc = host.ownerDocument;
  const column = doc.createElement("div");
  column.className = changed ? "ad-ly-chart__col ad-ly-chart__col--changed" : "ad-ly-chart__col";
  const head = doc.createElement("div");
  head.className = "ad-ly-chart__head";
  const titleElement = doc.createElement("strong");
  titleElement.textContent = title;
  const metaElement = doc.createElement("span");
  metaElement.textContent = meta;
  head.append(titleElement, metaElement);
  column.append(head);
  const ordered = [...yaos].sort((left, right) => right.position - left.position);
  for (const yao of ordered) column.append(renderYaoRow(host, yao, changed));
  return column;
}

function renderResult(host: HTMLElement, storage: LiuyaoStorage, reading?: ReadingSlot): void {
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

  const card = createResultCard(host, `${output.hexagramName}（${output.hexagramGong}宫 · ${output.hexagramElement}）`);
  const body = card.body;

  const meta = doc.createElement("p");
  meta.className = "ad-ly-meta";
  const timeText = `${output.ganZhiTime.year.gan}${output.ganZhiTime.year.zhi}年 ${output.ganZhiTime.month.gan}${output.ganZhiTime.month.zhi}月 ${output.ganZhiTime.day.gan}${output.ganZhiTime.day.zhi}日 ${output.ganZhiTime.hour.gan}${output.ganZhiTime.hour.zhi}时`;
  meta.textContent = `${timeText} · 旬空 ${output.kongWang.kongDizhi.join("")}`;
  body.append(meta);

  const chart = doc.createElement("div");
  chart.className = "ad-ly-chart";
  chart.append(renderChartColumn(host, output.hexagramName, `${output.hexagramGong}宫 · ${output.hexagramElement}`, output.fullYaos, false));
  if (output.changedHexagramName !== undefined) {
    // 变卦按六爻全画:动爻翻转并标注变后六亲纳甲,静爻保持本卦爻形。
    // taibu-core 只给动爻的 changedYao,静爻的纳甲在此按本卦显示(注释里说明)。
    const changedRows: FullYao[] = output.fullYaos.map((yao) => {
      const changed = yao.changedYao;
      const moving = yao.isChanging && changed !== null;
      return {
        position: yao.position,
        type: moving && changed !== null ? changed.type : yao.type,
        liuQin: moving && changed !== null ? changed.liuQin : yao.liuQin,
        naJia: moving && changed !== null ? changed.naJia : yao.naJia,
        wuXing: moving && changed !== null ? changed.wuXing : yao.wuXing,
        isShiYao: false,
        isYingYao: false,
        isChanging: false,
        kongWangState: "not_kong",
      } as unknown as FullYao;
    });
    chart.append(renderChartColumn(host, output.changedHexagramName, `${output.changedHexagramGong ?? ""}宫 · ${output.changedHexagramElement ?? ""}`, changedRows, true));
    const note = doc.createElement("p");
    note.className = "ad-ly-line ad-ly-line--muted";
    note.textContent = "变卦爻形按动爻翻转绘制;静爻的六亲纳甲取自本卦(本源库只提供动爻的变后信息),动爻显示变后六亲纳甲。";
    chart.append(note);
  }
  body.append(chart);

  const yongShenSection = doc.createElement("div");
  yongShenSection.className = "ad-ly-yongshen";
  for (const group of output.yongShen) {
    const block = doc.createElement("div");
    block.className = "ad-ly-yongshen__block";
    const title = doc.createElement("p");
    title.className = "ad-ly-relations__heading";
    title.textContent = `用神 · ${group.targetLiuQin}`;
    block.append(title);
    if (group.selectionNote !== "") {
      const note = doc.createElement("p");
      note.className = "ad-ly-line";
      note.textContent = group.selectionNote;
      block.append(note);
    }
    if (group.selected !== undefined) {
      const chips = doc.createElement("div");
      chips.className = "ad-bp-chips";
      chips.append(createChip(host, `主取 ${group.selected.liuQin}${group.selected.naJia}（${group.selected.position}爻）`, true));
      if (group.selected.isShiYao) chips.append(createChip(host, "世位"));
      chips.append(createChip(host, group.selected.movementLabel));
      chips.append(createChip(host, group.selected.strengthLabel));
      block.append(chips);
    }
    if (group.candidates.length > 0) {
      const candidates = doc.createElement("p");
      candidates.className = "ad-ly-line ad-ly-line--muted";
      candidates.textContent = `其余候选：${group.candidates.map((item) => `${item.liuQin}${item.naJia}（${item.position}爻）`).join("、")}`;
      block.append(candidates);
    }
    yongShenSection.append(block);
  }
  if (output.yongShen.length > 0) body.append(yongShenSection);

  for (const system of output.shenSystemByYongShen ?? []) {
    const parts: string[] = [];
    if (system.yuanShen !== undefined) parts.push(`原神 ${system.yuanShen.liuQin}（${system.yuanShen.wuXing}）`);
    if (system.jiShen !== undefined) parts.push(`忌神 ${system.jiShen.liuQin}（${system.jiShen.wuXing}）`);
    if (system.chouShen !== undefined) parts.push(`仇神 ${system.chouShen.liuQin}（${system.chouShen.wuXing}）`);
    if (parts.length === 0) continue;
    const line = doc.createElement("p");
    line.className = "ad-ly-line";
    line.textContent = parts.join(" · ");
    body.append(line);
  }

  const fuShenList = output.fullYaos
    .filter((yao) => yao.fuShen !== undefined)
    .map((yao) => yao.fuShen)
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  if (fuShenList.length > 0) {
    const fuShen = doc.createElement("p");
    fuShen.className = "ad-ly-line";
    fuShen.textContent = `伏神：${fuShenList.map((item) => `${item.liuQin}${item.naJia}${item.wuXing}（${item.relation}）`).join("、")}`;
    body.append(fuShen);
  }

  if ((output.timeRecommendations ?? []).length > 0) {
    const section = doc.createElement("div");
    section.className = "ad-ly-relations";
    const heading = doc.createElement("p");
    heading.className = "ad-ly-relations__heading";
    heading.textContent = "应期参考";
    section.append(heading);
    const chips = doc.createElement("div");
    chips.className = "ad-bp-chips";
    for (const item of output.timeRecommendations ?? []) {
      chips.append(createChip(host, `${item.targetLiuQin}：${item.description}`, item.type === "favorable"));
    }
    section.append(chips);
    body.append(section);
  }

  const gua = doc.createElement("div");
  gua.className = "ad-ly-gua";
  const guaCi = doc.createElement("p");
  guaCi.className = "ad-ly-gua__ci";
  guaCi.textContent = output.guaCi ?? "";
  const xiangCi = doc.createElement("p");
  xiangCi.className = "ad-ly-gua__xiang";
  xiangCi.textContent = output.xiangCi ?? "";
  gua.append(guaCi, xiangCi);
  if (output.changedGuaCi !== undefined) {
    const changed = doc.createElement("p");
    changed.className = "ad-ly-gua__xiang";
    changed.textContent = `变卦 ${output.changedHexagramName ?? ""}：${output.changedGuaCi}`;
    gua.append(changed);
  }
  body.append(gua);

  const nuclear = doc.createElement("p");
  nuclear.className = "ad-ly-line ad-ly-line--muted";
  nuclear.textContent = [
    output.nuclearHexagram === undefined ? "" : `互卦 ${output.nuclearHexagram.name}`,
    output.oppositeHexagram === undefined ? "" : `错卦 ${output.oppositeHexagram.name}`,
    output.reversedHexagram === undefined ? "" : `综卦 ${output.reversedHexagram.name}`,
  ].filter((part) => part !== "").join(" · ");
  if (nuclear.textContent !== "") body.append(nuclear);

  const flags: string[] = [];
  if (output.liuChongGuaInfo?.isLiuChongGua) flags.push("六冲卦");
  if (output.liuHeGuaInfo?.isLiuHeGua) flags.push("六合卦");
  if (output.guaFanFuYin?.isFanYin) flags.push("反吟");
  if (output.guaFanFuYin?.isFuYin) flags.push("伏吟");
  if (output.sanHeAnalysis?.hasFullSanHe) flags.push("三合齐全");
  if (output.sanHeAnalysis?.hasBanHe) flags.push("三合半合");
  if (flags.length > 0) {
    const flagChips = doc.createElement("div");
    flagChips.className = "ad-bp-chips";
    for (const flag of flags) flagChips.append(createChip(host, flag));
    body.append(flagChips);
  }

  if (output.globalShenSha.length > 0) {
    const shenSha = doc.createElement("p");
    shenSha.className = "ad-ly-line ad-ly-line--muted";
    shenSha.textContent = `卦内神煞：${output.globalShenSha.join("、")}`;
    body.append(shenSha);
  }

  reading?.paintInto(card.body);
  holder.append(card.root);
  host.replaceChildren(holder);
}

/**
 * 六爻面板:四种起卦方式 + 用神多选 + 图形化卦盘(本卦/变卦爻线对照)。
 * 爻线用 CSS 画阴阳(阳=实线,阴=断线),六亲世应动变以角标呈现。
 */
export const liuyaoPanel: BusiPanel = {
  id: "liuyao",
  label: "六爻",
  render(host, storage, ctx) {
    const raw = storage as LiuyaoStorage;
    const now = new Date();
    const question = raw.question ?? "";
    const method = raw.method ?? "auto";
    const dateValue = raw.dateValue ?? nowLocalInputValue(now);
    const numbers = raw.numbers ?? [1, 2, 3];
    const hexagramName = raw.hexagramName ?? HEXAGRAMS[0]?.name ?? "乾";
    const changedHexagramName = raw.changedHexagramName ?? "";
    const targets = raw.yongShenTargets ?? ["妻财"];

    host.replaceChildren();
    const doc = host.ownerDocument;
    const form = doc.createElement("form");
    form.className = "ad-bp-form";
    form.addEventListener("submit", (event) => event.preventDefault());

    const questionInput = createTextField(host, "所问何事", question, "必填:所问何事", true);
    const dateInput = doc.createElement("input");
    dateInput.type = "datetime-local";
    dateInput.value = dateValue;
    dateInput.className = "ad-bp-input";
    dateInput.setAttribute("aria-label", "起卦时间");
    const numberInputs: HTMLInputElement[] = [0, 1, 2].map((index) =>
      createNumberField(host, `第${index + 1}个数`, numbers[index] ?? 1, { min: 1, max: 999, width: "88px" }),
    );
    const benGuaSelect = createSelectField(host, "本卦", hexagramOptions(), hexagramName);
    const bianGuaSelect = createSelectField(host, "变卦", changedOptions(), changedHexagramName);

    const methodSegmented = createSegmented(
      host,
      METHODS,
      method,
      (value) => { raw.method = value; refreshExtras(); },
      "起卦方式",
    );

    const extras = doc.createElement("div");
    extras.className = "ad-bp-form__extras";
    const dateField = createField(host, "起卦时间", dateInput);
    const numbersField = doc.createElement("div");
    numbersField.className = "ad-bp-field";
    const numbersLabel = doc.createElement("span");
    numbersLabel.className = "ad-bp-field__label";
    numbersLabel.textContent = "三个数";
    numbersField.append(numbersLabel, ...numberInputs);
    const selectField = doc.createElement("div");
    selectField.className = "ad-bp-field";
    const selectLabel = doc.createElement("span");
    selectLabel.className = "ad-bp-field__label";
    selectLabel.textContent = "指定卦象";
    selectField.append(selectLabel, benGuaSelect, bianGuaSelect);
    extras.append(dateField, numbersField, selectField);
    const refreshExtras = (): void => {
      const active = raw.method ?? "auto";
      dateField.style.display = active === "number" || active === "select" ? "none" : "";
      numbersField.style.display = active === "number" ? "" : "none";
      selectField.style.display = active === "select" ? "" : "none";
    };

    const targetsField = doc.createElement("div");
    targetsField.className = "ad-bp-field ad-bp-field--wide";
    const targetsLabel = doc.createElement("span");
    targetsLabel.className = "ad-bp-field__label";
    targetsLabel.textContent = "用神(至少选一个)";
    targetsField.append(targetsLabel);
    const chips = doc.createElement("div");
    chips.className = "ad-bp-chips";
    const detachers: Array<() => void> = [];
    const paintTargets = (): void => {
      // 每轮重画前先解绑上一轮：detachers 只在最终 cleanup 统一清空，
      // 面板存活期内反复点击会无界累积。
      for (const detach of detachers.splice(0)) detach();
      chips.replaceChildren();
      for (const option of LIUQIN_OPTIONS) {
        const element = createChip(host, option.label, (raw.yongShenTargets ?? targets).includes(option.value));
        element.classList.add("ad-bp-chip--clickable");
        const toggle = (): void => {
          const current = raw.yongShenTargets ?? targets;
          raw.yongShenTargets = current.includes(option.value)
            ? current.filter((value) => value !== option.value)
            : [...current, option.value];
          paintTargets();
        };
        element.addEventListener("click", toggle);
        detachers.push(() => element.removeEventListener("click", toggle));
        chips.append(element);
      }
    };
    paintTargets();
    targetsField.append(chips);

    const resultHost = doc.createElement("div");
    resultHost.className = "ad-bp-panel__result-host";
    const reading = createReadingSlot({
      host,
      storage: raw,
      ctx,
      build: () => (raw.result === undefined ? null : readingRequestOf(raw, raw.result)),
    });

    const submit = createSubmitButton(host, "起卦", () => {
      const asked = questionInput.value;
      raw.question = asked;
      raw.dateValue = dateInput.value;
      raw.yongShenTargets = raw.yongShenTargets ?? targets;
      const active = raw.method ?? "auto";
      if (active === "select") {
        raw.hexagramName = benGuaSelect.value;
        raw.changedHexagramName = bianGuaSelect.value;
      }
      const selected = raw.yongShenTargets ?? [];
      if (asked.trim() === "") {
        raw.error = "请先填写所问何事";
        raw.result = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      if (selected.length === 0) {
        raw.error = "请至少选择一个用神(六亲)";
        raw.result = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      const coreDate = toCoreDateTime(raw.dateValue ?? dateValue);
      if (coreDate === null) {
        raw.error = "起卦时间不合法";
        raw.result = undefined;
        renderResult(resultHost, raw, reading);
        return;
      }
      if (active === "number") {
        // 清空输入框会得到 Number("") = 0;库会抛「numbers 必须是正整数」,面板先拦。
        const parsed = numberInputs.map((input) => Number(input.value));
        if (!parsed.every((value) => Number.isInteger(value) && value >= 1 && value <= 999)) {
          raw.error = "三个数都填 1–999 的整数";
          raw.result = undefined;
          renderResult(resultHost, raw, reading);
          return;
        }
        raw.numbers = parsed as [number, number, number];
      }
      raw.error = undefined;
      raw.result = undefined;
      // 上一卦的解卦不跟着新卦走。
      raw.reading = undefined;
      renderResult(resultHost, raw, reading);
      const input: Parameters<typeof calculateLiuyao>[0] = {
        question: asked,
        yongShenTargets: selected,
        method: active === "select" ? "select" : active === "time" ? "time" : active === "number" ? "number" : "auto",
        date: coreDate,
      };
      if (active === "number") {
        if (raw.numbers !== undefined) input.numbers = raw.numbers;
      }
      if (active === "select") {
        if (raw.hexagramName !== undefined) input.hexagramName = raw.hexagramName;
        const changed = raw.changedHexagramName;
        if (changed !== undefined && changed !== "") input.changedHexagramName = changed;
      }
      const requests = requestTokenFor(raw);
      const token = requests.next();
      void (async () => {
        try {
          const output = await Promise.resolve(calculateLiuyao(input));
          // 连点两次起卦时，先发起的那次结果不许再写回。
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

    form.append(createField(host, "所问何事", questionInput, true), methodSegmented.root, extras, targetsField, submit);

    // 自动摇卦在 taibu-core 里的种子是 `YYYY-MM-DDTHH | 所问何事 | 起卦方式`,
    // 即**同一小时内问同一件事结果固定**(不是「同一分钟」)。说不清的话,
    // 用户按旧文案去改分钟,改完还是同一卦,看起来像按钮坏了。
    const hint = doc.createElement("p");
    hint.className = "ad-bp-hint";
    hint.textContent = "自动摇卦以「起卦时间的小时 + 所问何事 + 起卦方式」为种子:同一小时内问同一件事会得到同一卦。想换一卦请把起卦时间改到别的时辰、换个问法,或改用数字起卦 / 手动选卦。";

    host.append(form, hint);
    host.append(resultHost);
    refreshExtras();
    renderResult(resultHost, raw, reading);

    return () => {
      methodSegmented.cleanup();
      for (const detach of detachers) detach();
      host.replaceChildren();
    };
  },
  harvest(host, storage) {
    const raw = storage as LiuyaoStorage;
    const question = readInputValue(host, "所问何事");
    const dateValue = readInputValue(host, "起卦时间");
    const method = readSegmentedValue(host, "起卦方式");
    const first = readNumberValue(host, "第1个数");
    const second = readNumberValue(host, "第2个数");
    const third = readNumberValue(host, "第3个数");
    const hexagramName = readInputValue(host, "本卦");
    const changedHexagramName = readInputValue(host, "变卦");
    if (question !== undefined) raw.question = question;
    if (dateValue !== undefined) raw.dateValue = dateValue;
    if (method !== undefined) raw.method = method;
    if (first !== undefined && second !== undefined && third !== undefined) {
      raw.numbers = [first, second, third];
    }
    if (hexagramName !== undefined) raw.hexagramName = hexagramName;
    if (changedHexagramName !== undefined) raw.changedHexagramName = changedHexagramName;
  },
};
