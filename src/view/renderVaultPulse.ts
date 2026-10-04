import type {
  HeatmapDay,
  ModuleState,
  VaultHealth,
} from "../domain/types";
import { createElement, renderModuleFallback } from "./domHelpers";
import { renderSectionHead } from "./renderSectionHead";

const BREAKDOWN_LABELS: Array<[keyof VaultHealth["breakdown"], string]> = [
  ["frontmatter", "Frontmatter"],
  ["links", "链接结构"],
  ["tags", "标签组织"],
  ["activity", "近期活跃"],
  ["inbox", "Inbox"],
];

const BREAKDOWN_CAPS: Record<keyof VaultHealth["breakdown"], number> = {
  frontmatter: 20,
  links: 25,
  tags: 15,
  activity: 20,
  inbox: 20,
};

function healthCompletion(value: number, cap: number): string {
  const safeValue = Number.isFinite(value) ? Math.min(cap, Math.max(0, value)) : 0;
  return `${Math.round((safeValue / cap) * 100)}%`;
}

function heatmapIntensity(count: number, maximum: number): number {
  if (count <= 0 || maximum <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / maximum) * 4)));
}

function safeWeekday(date: string): number {
  const parsed = new Date(`${date}T00:00:00`);
  const weekday = Number.isNaN(parsed.getTime()) ? 0 : parsed.getDay();
  return Math.min(6, Math.max(0, weekday));
}

function renderHealth(
  container: HTMLElement,
  state: ModuleState<VaultHealth | null>,
): void {
  const label = createElement(container, "p");
  label.className = "ad-eyebrow";
  // eslint-disable-next-line obsidianmd/ui/sentence-case -- Compact eyebrow label is intentionally uppercase.
  label.textContent = "VAULT HEALTH";
  container.append(label);

  if (
    renderModuleFallback(container, state, {
      loading: "正在计算 Vault 健康度…",
      empty: "数据不足。写下几篇笔记后，这里会给出透明的健康建议。",
      error: "健康度暂不可用。",
    })
  ) {
    return;
  }

  const health = state.data;
  if (health === null || health.insufficientData || health.score === null) {
    const insufficient = createElement(container, "p");
    insufficient.className = "ad-module-state";
    insufficient.dataset.state = "empty";
    insufficient.textContent = "数据不足。写下几篇笔记后，这里会给出透明的健康建议。";
    container.append(insufficient);
    return;
  }

  const scoreLine = createElement(container, "div");
  scoreLine.className = "ad-health__score-line";
  const score = createElement(container, "strong");
  score.className = "ad-health__score";
  score.textContent = String(health.score);
  const scoreCopy = createElement(container, "div");
  const verdict = createElement(container, "strong");
  verdict.textContent = health.score >= 80 ? "状态稳健" : "值得整理";
  const transparent = createElement(container, "span");
  transparent.textContent = "按五项固定规则计算，结果透明可追溯";
  scoreCopy.append(verdict, transparent);
  scoreLine.append(score, scoreCopy);

  const breakdown = createElement(container, "dl");
  breakdown.className = "ad-health__breakdown";
  for (const [key, name] of BREAKDOWN_LABELS) {
    const item = createElement(container, "div");
    const term = createElement(container, "dt");
    term.textContent = name;
    const value = createElement(container, "dd");
    value.textContent = healthCompletion(health.breakdown[key], BREAKDOWN_CAPS[key]);
    item.append(term, value);
    breakdown.append(item);
  }

  container.append(scoreLine, breakdown);
  if (health.suggestions.length > 0) {
    const suggestion = createElement(container, "p");
    suggestion.className = "ad-health__suggestion";
    suggestion.textContent = `建议：${health.suggestions[0]}`;
    container.append(suggestion);
  }
}

function renderHeatmap(
  container: HTMLElement,
  state: ModuleState<HeatmapDay[]>,
): void {
  const heading = createElement(container, "div");
  heading.className = "ad-panel-heading";
  const title = createElement(container, "h3");
  title.textContent = "一年创作节奏";
  const active = createElement(container, "span");
  active.textContent = `${state.data.filter((day) => day.count > 0).length} 个活跃日`;
  heading.append(title, active);
  container.append(heading);

  if (
    renderModuleFallback(container, state, {
      loading: "正在铺开创作热力图…",
      empty: "创建笔记后，这里会逐日显示你的创作节奏。",
      error: "热力图暂不可用。",
    })
  ) {
    return;
  }

  const maximum = Math.max(...state.data.map((day) => day.count), 0);
  const scroller = createElement(container, "div");
  scroller.className = "ad-heatmap__scroller";
  scroller.tabIndex = 0;
  scroller.setAttribute("aria-label", "过去一年笔记创建热力图，可横向滚动查看");

  // GitHub-style column-major weeks: pad the first week so day rows align
  // with real weekdays, then chunk the year into 7-day columns.
  const weeks: Array<Array<HeatmapDay | null>> = [];
  const firstDay = state.data[0];
  const firstWeekday = firstDay === undefined ? 0 : safeWeekday(firstDay.date);
  let currentWeek: Array<HeatmapDay | null> = Array.from({ length: firstWeekday }, () => null);
  for (const day of state.data) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  const monthsRow = createElement(container, "div");
  monthsRow.className = "ad-heatmap__months";
  monthsRow.setAttribute("aria-hidden", "true");
  let lastMonth = -1;
  for (const week of weeks) {
    const label = createElement(container, "span");
    label.className = "ad-heatmap__month";
    const first = week.find((day) => day !== null);
    if (first !== undefined) {
      const month = Number(first.date.slice(5, 7));
      if (Number.isInteger(month) && month !== lastMonth) {
        label.textContent = `${month}月`;
        lastMonth = month;
      }
    }
    monthsRow.append(label);
  }

  const grid = createElement(container, "div");
  grid.className = "ad-heatmap__grid";
  grid.setAttribute("role", "img");
  grid.setAttribute("aria-label", "过去一年每日创建笔记数量热力图");
  for (const week of weeks) {
    for (const day of week) {
      const cell = createElement(container, "span");
      if (day === null) {
        cell.className = "ad-heatmap__day ad-heatmap__day--blank";
        cell.setAttribute("aria-hidden", "true");
      } else {
        const description = `${day.date}：创建 ${day.count} 篇笔记`;
        cell.className = `ad-heatmap__day ad-heatmap__day--${heatmapIntensity(day.count, maximum)}`;
        cell.title = description;
        cell.setAttribute("aria-label", description);
      }
      grid.append(cell);
    }
  }
  scroller.append(monthsRow, grid);

  const legend = createElement(container, "div");
  legend.className = "ad-heatmap__legend";
  legend.append(container.ownerDocument.createTextNode("少"));
  for (let intensity = 0; intensity <= 4; intensity += 1) {
    const swatch = createElement(container, "span");
    swatch.className = `ad-heatmap__day ad-heatmap__day--${intensity}`;
    swatch.setAttribute("aria-hidden", "true");
    legend.append(swatch);
  }
  legend.append(container.ownerDocument.createTextNode("多"));
  container.append(scroller, legend);
}

export function renderVaultPulse(
  container: HTMLElement,
  health: ModuleState<VaultHealth | null>,
  heatmap: ModuleState<HeatmapDay[]>,
): void {
  container.replaceChildren();
  container.className = "ad-section";
  container.dataset.region = "pulse";
  // 批注:热力图覆盖的窗口长度,说明「脉搏」看的是哪一段。
  renderSectionHead(container, "Vault 脉搏", { meta: `${heatmap.data.length} 天` });
  const layout = createElement(container, "div");
  layout.className = "ad-pulse";
  const healthPanel = createElement(container, "div");
  healthPanel.className = "ad-health";
  const heatmapPanel = createElement(container, "div");
  heatmapPanel.className = "ad-heatmap";
  renderHealth(healthPanel, health);
  renderHeatmap(heatmapPanel, heatmap);
  layout.append(healthPanel, heatmapPanel);
  container.append(layout);
}
