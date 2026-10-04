import type {
  DashboardTask,
  ModuleState,
  RecentNote,
} from "../domain/types";
import { createElement, renderModuleFallback } from "./domHelpers";
import { renderSectionHead } from "./renderSectionHead";
import { renderSplitHandle } from "./splitHandle";
import { localDateKey } from "../features/vault/VaultScanner";

/**
 * A task list is grouped by source note. A group carries the note's own day when
 * one can be derived; tasks without a derivable day are grouped, never re-dated.
 */
interface TaskGroup {
  path: string;
  title: string;
  date?: string;
  hasToday: boolean;
  tasks: DashboardTask[];
}

function noteTitle(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").at(-1) ?? path;
  return name.replace(/\.md$/i, "");
}

function comparePaths(left: string, right: string): number {
  const normalizedLeft = left.replace(/\\/g, "/").toLowerCase();
  const normalizedRight = right.replace(/\\/g, "/").toLowerCase();
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

function compareTaskGroups(left: TaskGroup, right: TaskGroup): number {
  if (left.hasToday !== right.hasToday) return left.hasToday ? -1 : 1;
  if (left.date !== right.date) {
    if (left.date === undefined) return 1;
    if (right.date === undefined) return -1;
    return right.date < left.date ? -1 : 1;
  }
  return comparePaths(left.path, right.path);
}

function groupTasksByNote(
  tasks: readonly DashboardTask[],
  todayKey: string,
): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  for (const task of tasks) {
    let group = groups.get(task.path);
    if (group === undefined) {
      group = {
        path: task.path,
        title: noteTitle(task.path),
        tasks: [],
        hasToday: false,
      };
      groups.set(task.path, group);
    }
    group.tasks.push(task);
    if (task.date !== undefined && (group.date === undefined || task.date > group.date)) {
      group.date = task.date;
    }
    if (task.date === todayKey) group.hasToday = true;
  }
  return Array.from(groups.values()).sort(compareTaskGroups);
}

/**
 * Appends a panel heading and returns its trailing toolbar, so a panel can place
 * its own controls beside the meta line without owning the heading markup.
 */
function createPanelHeading(
  container: HTMLElement,
  title: string,
  meta: string,
): HTMLElement {
  const heading = createElement(container, "div");
  heading.className = "ad-panel-heading";

  const titleElement = createElement(container, "h3");
  titleElement.textContent = title;
  const toolbar = createElement(container, "div");
  toolbar.className = "ad-panel-toolbar";
  const metaElement = createElement(container, "span");
  metaElement.textContent = meta;
  toolbar.append(metaElement);
  heading.append(titleElement, toolbar);
  container.append(heading);
  return toolbar;
}

/**
 * Local view state the user owns. The panel re-renders on every state push
 * (feeds arrive one module at a time, plus the 5-minute tick), so without this
 * the 显示已完成 reveal and every collapsed note group would snap back.
 */
export interface TodayInteractionState {
  /** Explicit 显示已完成 choice; undefined keeps the "nothing left to do" default. */
  showCompleted?: boolean;
  /** Source-note paths of the task groups the user collapsed. */
  readonly collapsedTaskGroups: Set<string>;
}

export function createTodayInteractionState(): TodayInteractionState {
  return { collapsedTaskGroups: new Set<string>() };
}

function renderTasks(
  container: HTMLElement,
  state: ModuleState<DashboardTask[]>,
  onToggleTask?: (task: DashboardTask) => void,
  interaction?: TodayInteractionState,
): () => void {
  const cleanups: Array<() => void> = [];
  const incompleteCount = state.data.filter((task) => !task.completed).length;
  const completedCount = state.data.length - incompleteCount;
  const toolbar = createPanelHeading(container, "待办", `${incompleteCount} 项未完成`);
  if (
    renderModuleFallback(container, state, {
      loading: "正在整理今日任务…",
      empty: "还没有收集到待办。在任务来源文件夹的笔记里写下 - [ ] 任务 即可收进这里。",
      error: "今日任务暂不可用。",
    })
  ) {
    return () => undefined;
  }

  const list = createElement(container, "ul");
  list.className = "ad-task-list ad-stagger-list";

  if (completedCount > 0) {
    // Purely local: completed rows are always in the DOM and revealed by a class,
    // so toggling them never costs a rescan or a model round trip.
    let showCompleted = interaction?.showCompleted ?? incompleteCount === 0;
    const toggle = createElement(container, "button");
    toggle.type = "button";
    toggle.className = "ad-inline-action ad-task-toggle";
    toggle.textContent = `显示已完成（${completedCount}）`;
    toggle.setAttribute("aria-label", "显示或隐藏已完成任务");
    const applyToggleState = (): void => {
      list.classList.toggle("ad-task-list--show-completed", showCompleted);
      toggle.setAttribute("aria-pressed", String(showCompleted));
    };
    const handleToggle = (): void => {
      showCompleted = !showCompleted;
      if (interaction !== undefined) interaction.showCompleted = showCompleted;
      applyToggleState();
    };
    toggle.addEventListener("click", handleToggle);
    cleanups.push(() => toggle.removeEventListener("click", handleToggle));
    toolbar.append(toggle);
    applyToggleState();
  }

  const renderTask = (task: DashboardTask, parent: HTMLElement): void => {
    const item = createElement(container, "li");
    item.className = "ad-task";
    item.dataset.completed = String(task.completed);

    const checkbox = createElement(container, "input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.disabled = onToggleTask === undefined;
    checkbox.setAttribute(
      "aria-label",
      `${task.completed ? "已完成" : "未完成"}：${task.text}`,
    );

    const content = createElement(container, "div");
    content.className = "ad-task__content";
    const text = createElement(container, "span");
    text.className = "ad-task__text";
    text.textContent = task.text;
    content.append(text);
    if (task.dueDate !== undefined) {
      const metadata = createElement(container, "span");
      metadata.className = "ad-task__meta";
      metadata.textContent = `截止 ${task.dueDate}`;
      content.append(metadata);
    }
    item.append(checkbox, content);
    parent.append(item);

    if (onToggleTask !== undefined) {
      const handleChange = (): void => {
        checkbox.checked = task.completed;
        checkbox.disabled = true;
        onToggleTask(task);
      };
      checkbox.addEventListener("click", handleChange);
      cleanups.push(() => checkbox.removeEventListener("click", handleChange));
    }
  };

  const todayKey = localDateKey(new Date());
  for (const group of groupTasksByNote(state.data, todayKey)) {
    const item = createElement(container, "li");
    item.className = "ad-task-group";

    // Native disclosure: keyboard accessible, no listener, nothing hidden by default.
    const details = createElement(container, "details");
    details.className = "ad-task-group__details";
    details.open = interaction?.collapsedTaskGroups.has(group.path) !== true;
    if (interaction !== undefined) {
      const rememberGroupState = (): void => {
        if (details.open) interaction.collapsedTaskGroups.delete(group.path);
        else interaction.collapsedTaskGroups.add(group.path);
      };
      details.addEventListener("toggle", rememberGroupState);
      cleanups.push(() => details.removeEventListener("toggle", rememberGroupState));
    }

    const summary = createElement(container, "summary");
    summary.className = "ad-task-group__heading";
    const title = createElement(container, "span");
    title.className = "ad-task-group__title";
    title.textContent = group.title;
    summary.append(title);
    if (group.hasToday) {
      const badge = createElement(container, "span");
      badge.className = "ad-task-group__badge";
      badge.textContent = "今日";
      summary.append(badge);
    }
    const meta = createElement(container, "span");
    meta.className = "ad-task-group__meta";
    meta.textContent = `${group.date ?? "无日期"} · ${group.tasks.length} 项`;
    meta.setAttribute("title", group.path);
    summary.append(meta);
    details.append(summary);

    const groupList = createElement(container, "ul");
    groupList.className = "ad-task-group__list";
    for (const task of group.tasks) renderTask(task, groupList);
    details.append(groupList);
    item.append(details);
    list.append(item);
  }

  container.append(list);
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function renderNotes(
  container: HTMLElement,
  state: ModuleState<RecentNote[]>,
  onOpenNote?: (note: RecentNote) => void,
): () => void {
  createPanelHeading(container, "最近笔记", `${state.data.length} 篇`);
  if (
    renderModuleFallback(container, state, {
      loading: "正在整理最近笔记…",
      empty: "还没有最近笔记。新建一篇日记，让今天在 Vault 里留下痕迹。",
      error: "最近笔记暂不可用。",
    })
  ) {
    return () => undefined;
  }

  const cleanups: Array<() => void> = [];
  const list = createElement(container, "ul");
  list.className = "ad-note-list ad-stagger-list";
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  for (const note of state.data) {
    const item = createElement(container, "li");
    item.className = "ad-note";
    const action = createElement(container, "button");
    action.type = "button";
    action.className = "ad-note__open";
    action.disabled = onOpenNote === undefined;
    action.setAttribute("aria-label", `打开笔记：${note.title}`);
    const head = createElement(container, "span");
    head.className = "ad-note__head";
    const title = createElement(container, "strong");
    title.className = "ad-note__title";
    title.textContent = note.title;
    const time = createElement(container, "time");
    time.className = "ad-note__time";
    time.dateTime = new Date(note.modifiedAt).toISOString();
    time.textContent = formatter.format(note.modifiedAt);
    const path = createElement(container, "span");
    path.className = "ad-note__path";
    path.textContent = note.path;
    head.append(title, time);
    action.append(head, path);
    if (onOpenNote !== undefined) {
      const open = (): void => onOpenNote(note);
      action.addEventListener("click", open);
      cleanups.push(() => action.removeEventListener("click", open));
    }
    item.append(action);
    list.append(item);
  }
  container.append(list);
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

export interface TodaySplitOptions {
  /** Persisted notes-column width in px; 0 or missing keeps the responsive default. */
  notesWidth?: number;
  /** Called once per completed drag or keyboard nudge, never during the drag itself. */
  onNotesWidthChange?: (width: number) => void;
}

const NOTES_COLUMN_MIN_WIDTH = 240;
const TASKS_COLUMN_MIN_WIDTH = 360;

export function renderToday(
  container: HTMLElement,
  tasks: ModuleState<DashboardTask[]>,
  notes: ModuleState<RecentNote[]>,
  onToggleTask?: (task: DashboardTask) => void,
  onOpenNote?: (note: RecentNote) => void,
  split: TodaySplitOptions = {},
  interaction?: TodayInteractionState,
): () => void {
  container.replaceChildren();
  container.className = "ad-section";
  container.dataset.region = "today";

  // 批注写这个板块的口径:已完成 / 总数。
  renderSectionHead(container, "今天", {
    meta: `${tasks.data.filter((task) => task.completed).length} / ${tasks.data.length}`,
  });

  const layout = createElement(container, "div");
  layout.className = "ad-today";
  const tasksPanel = createElement(container, "div");
  tasksPanel.className = "ad-today__tasks";
  const notesPanel = createElement(container, "aside");
  notesPanel.className = "ad-today__notes";

  const cleanupTasks = renderTasks(tasksPanel, tasks, onToggleTask, interaction);
  const cleanupNotes = renderNotes(notesPanel, notes, onOpenNote);
  const cleanupSplitter = renderSplitHandle(layout, notesPanel, {
    trackProperty: "--ad-notes-track",
    minWidth: NOTES_COLUMN_MIN_WIDTH,
    siblingMinWidth: TASKS_COLUMN_MIN_WIDTH,
    width: split.notesWidth,
    onWidthChange: split.onNotesWidthChange,
    ariaLabel: "拖动调整待办与最近笔记的栏宽",
  });
  layout.append(tasksPanel, notesPanel);
  container.append(layout);
  return () => {
    cleanupTasks();
    cleanupNotes();
    cleanupSplitter();
  };
}