/* eslint-disable obsidianmd/ui/sentence-case -- Chinese UI preserves product names and standard acronyms. */
import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";

/** Small prompt dialog asking for a deep-research topic. Resolves null on dismiss. */
export class TopicPromptModal extends Modal {
  private settled = false;
  private resolve!: (topic: string | null) => void;
  private inputValue = "";

  private constructor(
    app: App,
    private readonly defaultTopic: string,
  ) {
    super(app);
  }

  static ask(app: App, defaultTopic: string): Promise<string | null> {
    const modal = new TopicPromptModal(app, defaultTopic);
    const promise = new Promise<string | null>((resolve) => {
      modal.resolve = resolve;
    });
    modal.open();
    return promise;
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "深度研究报告" });
    this.contentEl.createEl("p", { text: "输入研究主题，Codex 将以只读方式研究并生成 Markdown 报告到报告文件夹。" });
    new Setting(this.contentEl)
      .setName("研究主题")
      .addText((text) => {
        text.setValue(this.defaultTopic);
        text.inputEl.setAttribute("aria-label", "深度研究主题");
        text.inputEl.addEventListener("input", () => {
          this.inputValue = text.getValue();
        });
        text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.finish(text.getValue());
          }
        });
        this.inputValue = this.defaultTopic;
        window.setTimeout(() => text.inputEl.focus(), 0);
      })
      .addButton((button) => {
        button.setButtonText("开始研究").setCta().onClick(() => {
          this.finish(this.inputValue);
        });
      });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
  }

  private finish(rawTopic: string): void {
    if (this.settled) return;
    const topic = rawTopic.trim();
    this.settled = true;
    this.resolve(topic === "" ? null : topic);
    this.close();
  }
}
