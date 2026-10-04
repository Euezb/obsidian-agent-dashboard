/**
 * 「卜筮」板块共享的 DOM 小部件。
 * 全部遵循插件既有约定:createElement 只创建不挂载、textContent 写文本、
 * 按钮必须显式 type,事件监听通过返回的清理函数回收。
 */

/** 带标签的表单项;返回 wrap 与控件本体。 */
export function createField(
  host: HTMLElement,
  label: string,
  control: HTMLElement,
  grow = false,
): HTMLElement {
  const doc = host.ownerDocument;
  const wrap = doc.createElement("div");
  wrap.className = grow ? "ad-bp-field ad-bp-field--grow" : "ad-bp-field";
  const labelElement = doc.createElement("label");
  labelElement.className = "ad-bp-field__label";
  labelElement.textContent = label;
  wrap.append(labelElement, control);
  return wrap;
}

export function createNumberField(
  host: HTMLElement,
  label: string,
  value: number,
  options: { min: number; max: number; width?: string },
): HTMLInputElement {
  const input = host.ownerDocument.createElement("input");
  input.type = "number";
  input.value = String(value);
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = "1";
  input.className = "ad-bp-input";
  input.setAttribute("aria-label", label);
  if (options.width !== undefined) input.style.width = options.width;
  return input;
}

export function createTextField(
  host: HTMLElement,
  label: string,
  value: string,
  placeholder: string,
  grow = false,
): HTMLInputElement {
  const input = host.ownerDocument.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.className = "ad-bp-input";
  input.setAttribute("aria-label", label);
  if (grow) input.classList.add("ad-bp-input--grow");
  return input;
}

export interface SelectOption {
  value: string;
  label: string;
}

export function createSelectField(
  host: HTMLElement,
  label: string,
  options: ReadonlyArray<SelectOption>,
  selected: string,
): HTMLSelectElement {
  const doc = host.ownerDocument;
  const select = doc.createElement("select");
  select.className = "ad-bp-input";
  select.setAttribute("aria-label", label);
  for (const option of options) {
    const element = doc.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    if (option.value === selected) element.selected = true;
    select.append(element);
  }
  return select;
}

export function createCheckboxField(
  host: HTMLElement,
  label: string,
  checked: boolean,
): { wrap: HTMLElement; input: HTMLInputElement } {
  const doc = host.ownerDocument;
  const wrap = doc.createElement("div");
  wrap.className = "ad-bp-field ad-bp-field--inline";
  const input = doc.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.className = "ad-bp-checkbox";
  input.id = `ad-bp-cb-${label}`;
  const labelElement = doc.createElement("label");
  labelElement.className = "ad-bp-field__label ad-bp-field__label--inline";
  labelElement.textContent = label;
  labelElement.htmlFor = input.id;
  wrap.append(input, labelElement);
  return { wrap, input };
}

/** 分段按钮组(复用 .ad-segmented 视觉),选中项通过 aria-pressed 暴露。 */
export function createSegmented(
  host: HTMLElement,
  options: ReadonlyArray<SelectOption>,
  selected: string,
  onSelect: (value: string) => void,
  ariaLabel: string,
): { root: HTMLElement; cleanup: () => void } {
  const doc = host.ownerDocument;
  const root = doc.createElement("div");
  root.className = "ad-segmented ad-bp-segmented";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", ariaLabel);
  const detachers: Array<() => void> = [];
  const markSelection = (value: string): void => {
    for (const child of Array.from(root.children)) {
      (child as HTMLElement).setAttribute(
        "aria-pressed",
        String((child as HTMLElement).dataset.value === value),
      );
    }
  };
  for (const option of options) {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.dataset.value = option.value;
    button.setAttribute("aria-pressed", String(option.value === selected));
    const select = (): void => {
      onSelect(option.value);
      markSelection(option.value);
    };
    button.addEventListener("click", select);
    detachers.push(() => button.removeEventListener("click", select));
    root.append(button);
  }
  return {
    root,
    cleanup: () => {
      for (const detach of detachers) detach();
    },
  };
}

/** 结果卡片:带标题的承载容器,正文由调用方追加。 */
export function createResultCard(
  host: HTMLElement,
  title: string,
): { root: HTMLElement; body: HTMLElement } {
  const doc = host.ownerDocument;
  const root = doc.createElement("div");
  root.className = "ad-bp-result";
  const heading = doc.createElement("div");
  heading.className = "ad-bp-result__heading";
  const titleElement = doc.createElement("strong");
  titleElement.className = "ad-bp-result__title";
  titleElement.textContent = title;
  heading.append(titleElement);
  root.append(heading);
  const body = doc.createElement("div");
  body.className = "ad-bp-result__body";
  root.append(body);
  return { root, body };
}

/** 胶囊标签;hit 为结果位时高亮。 */
export function createChip(
  host: HTMLElement,
  text: string,
  hit = false,
): HTMLElement {
  const chip = host.ownerDocument.createElement("span");
  chip.className = hit ? "ad-bp-chip ad-bp-chip--hit" : "ad-bp-chip";
  chip.textContent = text;
  return chip;
}

/** 面板级状态提示(加载/错误/空),样式与资讯模块一致。 */
export function createPanelNotice(
  host: HTMLElement,
  kind: "loading" | "error" | "empty",
  message: string,
): HTMLElement {
  const notice = host.ownerDocument.createElement("p");
  notice.className = `ad-module-state ad-module-state--${kind}`;
  notice.dataset.state = kind;
  notice.setAttribute("role", "status");
  notice.textContent = message;
  return notice;
}

/** 表单快捷键提交按钮。 */
export function createSubmitButton(
  host: HTMLElement,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = host.ownerDocument.createElement("button");
  button.type = "submit";
  button.className = "ad-primary-action ad-bp-submit";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

/** 把 datetime-local 值规范成 taibu-core 的 "YYYY-MM-DDTHH:MM:00"。 */
export function toCoreDateTime(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (match === null) return null;
  const date = match[1];
  const time = match[2];
  if (date === undefined || time === undefined) return null;
  return `${date}T${time}:00`;
}

/** 当前本地时间的 datetime-local 默认值。 */
export function nowLocalInputValue(now: Date): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return `${date}T${time}`;
}

/** 失败提示统一走 notice,保证面板里错误可读且带状态语义。 */
export function collectError(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return "计算失败,请检查输入后重试。";
}

/**
 * 按 aria-label 找控件。用扫描而非属性选择器,避免标签里的括号/引号需要转义;
 * 用 tagName 而非 instanceof,避免弹窗(popout)窗口里跨 realm 的元素判定失效。
 */
function findLabeled(host: HTMLElement, label: string): HTMLElement | null {
  const candidates = Array.from(host.querySelectorAll<HTMLElement>("[aria-label]"));
  return candidates.find((element) => element.getAttribute("aria-label") === label) ?? null;
}

/** 读取具名输入框/下拉框的当前值;找不到返回 undefined。 */
export function readInputValue(host: HTMLElement, label: string): string | undefined {
  const element = findLabeled(host, label);
  if (element === null) return undefined;
  if (element.tagName !== "INPUT" && element.tagName !== "SELECT") return undefined;
  return (element as HTMLInputElement | HTMLSelectElement).value;
}

/** 读取具名数字输入框;空值或非有限数返回 undefined,避免把 NaN 写进会话状态。 */
export function readNumberValue(host: HTMLElement, label: string): number | undefined {
  const value = readInputValue(host, label);
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 按可见标签文本读取复选框状态(复选框用 label[for] 关联,没有 aria-label)。 */
export function readCheckboxValue(host: HTMLElement, label: string): boolean | undefined {
  const fields = Array.from(host.querySelectorAll<HTMLElement>(".ad-bp-field--inline"));
  for (const field of fields) {
    const text = field.querySelector("label")?.textContent?.trim();
    if (text !== label) continue;
    const input = field.querySelector("input");
    return input?.checked;
  }
  return undefined;
}

/** 读取分段按钮组当前选中项的 data-value。 */
export function readSegmentedValue(host: HTMLElement, ariaLabel: string): string | undefined {
  const group = findLabeled(host, ariaLabel);
  const pressed = group?.querySelector('[aria-pressed="true"]');
  return pressed?.getAttribute("data-value") ?? undefined;
}

/**
 * 运行环境的 IANA 时区。术语数依赖「起课地」的时间,写死时区会让异地用户排错盘;
 * 取不到(老运行时、容器裁剪)时回落到本域默认口径。
 */
export function systemTimeZone(fallback = "Asia/Shanghai"): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone !== "" ? zone : fallback;
  } catch {
    return fallback;
  }
}
