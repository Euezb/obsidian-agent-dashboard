import type {
  DashboardTask,
  ModuleState,
  RecentNote,
} from "../domain/types";
import { createElement, renderModuleFallback } from "./domHelpers";
import { localDateKey } from "../features/vault/VaultScanner";

function createPanelHeading(
  container: HTMLElement,
  title: string,
  meta: string,
): HTMLElement {
  const heading = createElement(container, "div");
  heading.className = "ad-panel-heading";

  const titleElement = createElement(container, "h3");
  titleElement.textContent = title;
  const metaElement = createElement(container, "span");
  metaElement.textContent = meta;
  heading.append(titleElement, metaElement);
  return heading;
}

function renderTasks(
  container: HTMLElement,
  state: ModuleState<DashboardTask[]>,
  onToggleTask?: (task: DashboardTask) => void,
): () => void {
  const cleanups: Array<() => void> = [];
  container.append(
    createPanelHeading(container, "待办", `${state.data.filter((task) => !task.completed).length} 项未完成`),
  );
  if (
    renderModuleFallback(container, state, {
      loading: "正在整理今日任务…",
      empty: "今天还没有任务。在任意笔记中写下标准 Markdown 复选框即可收进这里。",
      error: "今日任务暂不可用。",
    })
  ) {
    return () => undefined;
  }

  const list = createElement(container, "ul");
  list.className = "ad-task-list ad-stagger-list";

  const todayKey = localDateKey(new Date());
  const todayTasks = state.data.filter((task) => !task.completed && task.date === todayKey);
  const earlierTasks = state.data.filter((task) => !task.completed && task.date !== todayKey);

  const renderGroup = (tasks: DashboardTask[], label: string): void => {
    if (tasks.length === 0) return;
    const labelItem = createElement(container, "li");
    labelItem.className = "ad-task-group-label";
    labelItem.textContent = label;
    labelItem.setAttribute("aria-hidden", "true");
    list.append(labelItem);
    for (const task of tasks) renderTask(task);
  };

  const renderTask = (task: DashboardTask): void => {
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
    const metadata = createElement(container, "span");
    metadata.className = "ad-task__meta";
    metadata.textContent = task.dueDate
      ? `截止 ${task.dueDate} · ${task.path}`
      : task.path;
    content.append(text, metadata);
    item.append(checkbox, content);
    list.append(item);

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

  renderGroup(todayTasks, "本日待办");
  if (earlierTasks.length > 0 && todayTasks.length > 0) {
    const divider = createElement(container, "li");
    divider.className = "ad-task-divider";
    divider.setAttribute("role", "separator");
    list.append(divider);
  }
  renderGroup(earlierTasks, "之前未完成");
  container.append(list);
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function renderNotes(
  container: HTMLElement,
  state: ModuleState<RecentNote[]>,
): void {
  container.append(createPanelHeading(container, "最近笔记", `${state.data.length} 篇`));
  if (
    renderModuleFallback(container, state, {
      loading: "正在整理最近笔记…",
      empty: "还没有最近笔记。新建一篇日记，让今天在 Vault 里留下痕迹。",
      error: "最近笔记暂不可用。",
    })
  ) {
    return;
  }

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
    const title = createElement(container, "strong");
    title.textContent = note.title;
    const path = createElement(container, "span");
    path.className = "ad-note__path";
    path.textContent = note.path;
    const time = createElement(container, "time");
    time.dateTime = new Date(note.modifiedAt).toISOString();
    time.textContent = formatter.format(note.modifiedAt);
    item.append(title, path, time);
    list.append(item);
  }
  container.append(list);
}

export function renderToday(
  container: HTMLElement,
  tasks: ModuleState<DashboardTask[]>,
  notes: ModuleState<RecentNote[]>,
  onToggleTask?: (task: DashboardTask) => void,
): () => void {
  container.replaceChildren();
  container.className = "ad-section";
  container.dataset.region = "today";

  const title = createElement(container, "h2");
  title.className = "ad-section__title";
  title.textContent = "今天";

  const layout = createElement(container, "div");
  layout.className = "ad-today";
  const tasksPanel = createElement(container, "div");
  tasksPanel.className = "ad-today__tasks";
  const notesPanel = createElement(container, "aside");
  notesPanel.className = "ad-today__notes";

  const cleanupTasks = renderTasks(tasksPanel, tasks, onToggleTask);
  renderNotes(notesPanel, notes);
  layout.append(tasksPanel, notesPanel);
  container.append(title, layout);
  return cleanupTasks;
}
