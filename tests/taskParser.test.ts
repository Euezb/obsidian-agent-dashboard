import { describe, expect, it } from "vitest";
import { parseTasks } from "../src/features/vault/taskParser";

describe("parseTasks", () => {
  it("parses incomplete, completed, uppercase-X, and indented tasks", () => {
    const markdown = [
      "# Today",
      "- [ ] Draft plan 📅 2026-06-28",
      "  - [x] Review notes",
      "\t- [X] Publish summary",
      "plain text",
    ].join("\n");

    expect(parseTasks("Today.md", markdown)).toEqual([
      {
        id: "Today.md:1",
        path: "Today.md",
        line: 1,
        text: "Draft plan",
        completed: false,
        dueDate: "2026-06-28",
      },
      {
        id: "Today.md:2",
        path: "Today.md",
        line: 2,
        text: "Review notes",
        completed: true,
      },
      {
        id: "Today.md:3",
        path: "Today.md",
        line: 3,
        text: "Publish summary",
        completed: true,
      },
    ]);
  });

  it("ignores headings, plain text, malformed task markers, and other list rows", () => {
    const markdown = [
      "# Heading",
      "plain text",
      "- [ ]missing separator",
      "- item",
      "1. [ ] numbered item",
      "+ [ ] alternate bullet",
      "- [/] unsupported marker",
    ].join("\n");

    expect(parseTasks("Ignored.md", markdown)).toEqual([]);
  });

  it("uses stable zero-based source identity without rewriting Windows paths", () => {
    const path = String.raw`Projects\Agent\Today.md`;
    const markdown = "intro\n\n- [ ] Ship parser";

    const first = parseTasks(path, markdown);
    const second = parseTasks(path, markdown);

    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({
      id: String.raw`Projects\Agent\Today.md:2`,
      path,
      line: 2,
    });
  });

  it("does not treat an unmarked date as a due date or interpret recurrence syntax", () => {
    const [task] = parseTasks(
      "Tasks.md",
      "- [ ] Review 2026-06-28 🔁 every week ⏫",
    );

    expect(task).toEqual({
      id: "Tasks.md:0",
      path: "Tasks.md",
      line: 0,
      text: "Review 2026-06-28 🔁 every week ⏫",
      completed: false,
    });
  });

  it("uses the first due-date token and removes all standard tokens from display text", () => {
    const [task] = parseTasks(
      "Dates.md",
      "- [ ] First   📅 2026-06-28   then 📅 2026-07-01   done",
    );

    expect(task).toMatchObject({
      text: "First then done",
      dueDate: "2026-06-28",
    });
  });

  it("retains a source task whose display text is empty after stripping its due date", () => {
    expect(parseTasks("Empty.md", "- [ ] 📅 2026-06-28")).toEqual([
      {
        id: "Empty.md:0",
        path: "Empty.md",
        line: 0,
        text: "",
        completed: false,
        dueDate: "2026-06-28",
      },
    ]);
  });

  it.each([
    ["- [ ] **Step 1: 新增失败测试**", "Step 1: 新增失败测试"],
    ["- [ ] 运行 `run_case` 并确认 **红灯**", "运行 run_case 并确认 红灯"],
    ["- [ ] *重点* 与 ~~删除~~ 与 ==高亮==", "重点 与 删除 与 高亮"],
    ["- [ ] 参考 [[目标笔记#小节|目标笔记]]", "参考 目标笔记"],
    ["- [ ] 参考 [[目标笔记#小节]]", "参考 目标笔记"],
    ["- [ ] 见 [官方文档](https://example.com/docs)", "见 官方文档"],
    ["- [ ] **发版** 📅 2026-07-01", "发版"],
  ])("shows %j as plain text", (source, expected) => {
    expect(parseTasks("Plan.md", source)[0]?.text).toBe(expected);
  });

  it("keeps due dates while stripping Markdown and leaves math and identifiers alone", () => {
    const [dated] = parseTasks("Plan.md", "- [ ] **发版** 📅 2026-07-01");
    expect(dated).toMatchObject({ text: "发版", dueDate: "2026-07-01" });

    const [literal] = parseTasks("Math.md", "- [ ] 计算 2*3*4 与 snake_case_name");
    expect(literal?.text).toBe("计算 2*3*4 与 snake_case_name");

    const [code] = parseTasks("Code.md", "- [ ] 调用 `a*b*c` 与 `**raw**`");
    expect(code?.text).toBe("调用 a*b*c 与 **raw**");
  });

  it("marks tasks that live under an archive heading and stops at the next heading", () => {
    const markdown = [
      "## Tasks",
      "- [x] Today's own work",
      "## 归档",
      "- [x] Carried-over work",
      "- [ ] Unchecked carried-over work",
      "### Sub-heading inside the archive",
      "- [x] Still carried over",
      "## Notes",
      "- [x] Not carried over",
    ].join("\n");

    expect(parseTasks("Daily/2026-09-29.md", markdown).map((task) => [task.text, task.archived]))
      .toEqual([
        ["Today's own work", undefined],
        ["Carried-over work", true],
        ["Unchecked carried-over work", true],
        ["Still carried over", true],
        ["Not carried over", undefined],
      ]);
  });
});
