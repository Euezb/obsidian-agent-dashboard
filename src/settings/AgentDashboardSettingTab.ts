/* eslint-disable obsidianmd/ui/sentence-case -- Chinese UI preserves product names and standard acronyms. */
import { Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type AgentDashboardPlugin from "../main";
import type { AgentDashboardSettings } from "./settings";
import { cloneSettingValue } from "../infrastructure/cloneSettingValue";
import { runConfirmed } from "./CacheMaintenance";
import { SafeActionQueue, SafeButtonActionRunner } from "./SafeActionQueue";
import {
  commitControlValue,
  type SettingValueControl,
} from "./SettingControlPersistence";
import {
  missingVaultFolders,
  normalizeApiSummarizer,
  normalizeGithubSecretName,
  normalizeTtlMinutes,
  normalizeVaultRelativeFolder,
  parseRssFeedLines,
  parseVaultFolderLines,
} from "./settingsValidation";

type FolderKey = "dailyFolder" | "inboxFolder" | "reportsFolder" | "cacheFolder";
type FolderListKey = "taskIncludeFolders" | "taskExcludeFolders";

const RECOMMENDED_RSS_FEEDS: ReadonlyArray<readonly [string, string]> = [
  ["HuggingFace Papers", "https://huggingface.co/papers/rss"],
  ["OpenAI Blog", "https://openai.com/blog/rss.xml"],
  ["Google DeepMind", "https://deepmind.google/blog/rss.xml"],
  ["MIT TR: AI", "https://www.technologyreview.com/topic/artificial-intelligence/feed"],
];

export class AgentDashboardSettingTab extends PluginSettingTab {
  private readonly saveActions = new SafeActionQueue();
  private readonly buttonActions = new SafeButtonActionRunner(new SafeActionQueue());

  constructor(app: App, private readonly dashboardPlugin: AgentDashboardPlugin) {
    super(app, dashboardPlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("agent-dashboard-settings");

    new Setting(containerEl).setName("文件与缓存").setHeading();
    this.addFolderSetting("日记文件夹", "新建日记的 Vault 相对路径。", "dailyFolder");
    this.addFolderSetting("收件箱文件夹", "用于健康度计算的收件箱路径。", "inboxFolder");
    this.addFolderSetting("报告文件夹", "深度研究报告与 Vault 体检报告的保存路径。", "reportsFolder");
    this.addFolderSetting("缓存文件夹", "插件工作文件的 Vault 相对路径；榜单与摘要缓存保存在插件数据目录，不占用同步空间。修改后请重启 Obsidian。", "cacheFolder");

    new Setting(containerEl)
      .setName("缓存有效期")
      .setDesc("外部资讯缓存的有效时间，范围为 15–1440 分钟。")
      .addText((text) => {
        text.setValue(String(this.dashboardPlugin.settings.externalCacheTtlMinutes));
        text.inputEl.type = "number";
        text.inputEl.min = "15";
        text.inputEl.max = "1440";
        text.inputEl.step = "1";
        text.inputEl.setAttribute("aria-label", "缓存有效期（分钟）");
        text.inputEl.addEventListener("change", () => {
          const ttl = normalizeTtlMinutes(Number(text.getValue()));
          if (ttl === null) return void new Notice("缓存有效期必须是数字");
          void this.commitControl(text, "externalCacheTtlMinutes", ttl, String);
        });
      });

    new Setting(containerEl).setName("待办来源").setHeading();
    this.addFolderListSetting(
      "任务来源文件夹",
      "每行一个 Vault 相对路径；留空表示扫描全库。填写后只收集这些文件夹里的复选框，其它笔记的待办不会出现在面板里。修改后立即重扫。",
      "taskIncludeFolders",
    );
    this.addFolderListSetting(
      "任务排除文件夹",
      "每行一个 Vault 相对路径；这些文件夹里的复选框永远不会进入待办列表，优先级高于来源文件夹。",
      "taskExcludeFolders",
    );

    new Setting(containerEl).setName("资讯来源").setHeading();
    new Setting(containerEl)
      .setName("RSS 订阅")
      .setDesc("每行一个 http(s) 地址；无效地址不会保存。")
      .addTextArea((area) => {
        area.setValue(this.dashboardPlugin.settings.rssFeeds.join("\n"));
        area.inputEl.rows = 5;
        area.inputEl.setAttribute("aria-label", "RSS 订阅地址，每行一个");
        area.inputEl.addEventListener("change", () => {
          const parsed = parseRssFeedLines(area.getValue());
          if (!parsed.ok) return void new Notice("RSS 地址无效，设置未保存");
          void this.commitControl(area, "rssFeeds", parsed.feeds, (feeds) => feeds.join("\n"));
        });
      });

    const recommended = new Setting(containerEl)
      .setName("推荐订阅")
      .setDesc("一键添加常用 AI 资讯源；已存在的地址不会重复添加。");
    for (const [label, url] of RECOMMENDED_RSS_FEEDS) {
      recommended.addButton((button) => {
        button.setButtonText(label).onClick(() => {
          // 读当前订阅、判重、写入必须一起排进串行队列：连点两个按钮时，
          // 第二次点击若在第一次落盘前读到旧数组，先加的那个源会被整个覆盖掉。
          void this.saveActions.run(async () => {
            const current = this.dashboardPlugin.settings.rssFeeds;
            if (current.includes(url)) {
              new Notice(`${label} 已在订阅列表中`);
              return;
            }
            await this.dashboardPlugin.updateSetting("rssFeeds", [...current, url]);
            new Notice(`已添加订阅：${label}，重新打开设置可看到更新`);
          }, () => { new Notice("保存设置失败"); });
        });
      });
    }

    new Setting(containerEl).setName("今日摘要").setHeading();
    new Setting(containerEl)
      .setName("自动生成每日摘要")
      .setDesc("每天首次获得新资讯后自动生成一次摘要；失败不会在当天反复自动运行，可在面板手动重试。摘要由下方直连 API 生成。")
      .addToggle((toggle) => {
        toggle.setValue(this.dashboardPlugin.settings.autoDailySummary);
        toggle.toggleEl.setAttribute("aria-label", "自动生成每日摘要");
        toggle.onChange((value) => {
          void this.commitControl(toggle, "autoDailySummary", value, (enabled) => enabled);
        });
      });


    new Setting(containerEl).setName("卜筮").setHeading();
    new Setting(containerEl)
      .setName("启用卜筮")
      .setDesc("在面板中显示头部今日黄历卡与「卜筮」板块（六爻、八字、紫微等）。术数全部本地计算，不联网、不调用大模型；关闭只是不显示，不影响包体积。")
      .addToggle((toggle) => {
        toggle.setValue(this.dashboardPlugin.settings.bushiEnabled);
        toggle.toggleEl.setAttribute("aria-label", "启用卜筮");
        toggle.onChange((value) => {
          // 显示类开关:保存成功后立刻让已打开的面板重渲染,不必等下一次整页刷新。
          void this.commitControl(toggle, "bushiEnabled", value, (enabled) => enabled).then((saved) => {
            if (saved) this.dashboardPlugin.refreshOpenViews();
          });
        });
      });
    new Setting(containerEl)
      .setName("卜筮解卦")
      .setDesc("在「今日一牌」与卜筮九个方法（塔罗、小六壬、六爻、太乙、大六壬、八字、紫微、八字合盘、日运月运）的结果下方显示大模型解卦。用的是下面「直连 API 摘要」那一套接口与模型，卦象本身仍然完全本地计算；关闭只是不生成解卦文字。")
      .addToggle((toggle) => {
        toggle.setValue(this.dashboardPlugin.settings.bushiReadingEnabled);
        toggle.toggleEl.setAttribute("aria-label", "卜筮解卦");
        toggle.onChange((value) => {
          void this.commitControl(toggle, "bushiReadingEnabled", value, (enabled) => enabled).then((saved) => {
            if (saved) this.dashboardPlugin.refreshOpenViews();
          });
        });
      });
    new Setting(containerEl)
      .setName("解卦发送所问之事")
      .setDesc("打开：面板里手写的「问题」（塔罗、小六壬、六爻、太乙、大六壬有这一栏）会随卦象一起发送给上面配置的模型。关闭：只发方法名与卦象事实行，问题不出本机。牌面图、盘面图、笔记内容、缓存都不会发送。")
      .addToggle((toggle) => {
        toggle.setValue(this.dashboardPlugin.settings.bushiReadingSendsQuestion);
        toggle.toggleEl.setAttribute("aria-label", "解卦发送所问之事");
        toggle.onChange((value) => {
          void this.commitControl(toggle, "bushiReadingSendsQuestion", value, (enabled) => enabled);
        });
      });

    new Setting(containerEl).setName("直连 API 摘要").setHeading();
    new Setting(containerEl)
      .setName("接口地址")
      .setDesc("OpenAI 兼容接口根地址，如 https://opencode.ai/zen/go/v1。留空则不生成今日摘要与报告。")
      .addText((text) => {
        text.setValue(this.dashboardPlugin.settings.apiSummarizer.providerBaseURL);
        text.inputEl.setAttribute("aria-label", "API 摘要接口地址");
        text.inputEl.addEventListener("change", () => {
          const raw = text.getValue();
          // 这一格的格式校验只依赖用户输入，不依赖 settings，可以留在事件时刻。
          const preview = normalizeApiSummarizer({
            ...this.dashboardPlugin.settings.apiSummarizer,
            providerBaseURL: raw,
          });
          if (preview.providerBaseURL !== "" &&
            preview.providerBaseURL.replace(/\/+$/, "") !== raw.trim().replace(/\/+$/, "")) {
            return void new Notice("接口地址无效，设置未保存");
          }
          void this.commitControl(
            text,
            "apiSummarizer",
            // 落盘用的对象等队列轮到它时再按当时的设置拼装，避免覆盖前一次改动。
            (current) => normalizeApiSummarizer({ ...current, providerBaseURL: raw }),
            (value) => value.providerBaseURL,
          );
        });
      });
    new Setting(containerEl)
      .setName("API 模型")
      .setDesc("接口侧的模型 id，如 glm-5.3-flash。")
      .addText((text) => {
        text.setValue(this.dashboardPlugin.settings.apiSummarizer.model);
        text.inputEl.setAttribute("aria-label", "API 摘要模型");
        text.inputEl.addEventListener("change", () => {
          const raw = text.getValue();
          void this.commitControl(
            text,
            "apiSummarizer",
            (current) => normalizeApiSummarizer({ ...current, model: raw }),
            (value) => value.model,
          );
        });
      });
    new Setting(containerEl)
      .setName("API 密钥环境变量名")
      .setDesc("只保存环境变量的名字（如 OPENCODE_API_KEY）；密钥值本身在 Obsidian 启动环境中读取，不写入插件数据。")
      .addText((text) => {
        text.setValue(this.dashboardPlugin.settings.apiSummarizer.apiKeyEnv);
        text.inputEl.setAttribute("aria-label", "API 密钥环境变量名");
        text.inputEl.addEventListener("change", () => {
          const raw = text.getValue();
          void this.commitControl(
            text,
            "apiSummarizer",
            (current) => normalizeApiSummarizer({ ...current, apiKeyEnv: raw }),
            (value) => value.apiKeyEnv,
          );
        });
      });


    new Setting(containerEl).setName("GitHub").setHeading();
    this.addGithubSecretSetting();

    new Setting(containerEl).setName("维护").setHeading();
    new Setting(containerEl)
      .setName("重新生成缓存")
      .setDesc("清除本插件生成的资讯缓存；下次打开 Dashboard 时重新获取。")
      .addButton((button) => {
        button.setButtonText("重新生成缓存");
        button.buttonEl.setAttribute("aria-label", "确认重新生成 Agent Dashboard 缓存");
        button.onClick(() => {
          void this.buttonActions.run(button, () => runConfirmed(
            () => ConfirmationModal.ask(this.app, "重新生成缓存？", "只会清除当前缓存文件夹中的 Agent Dashboard 资讯缓存。请仅在你信任的本地 Vault 中使用。"),
            async () => {
              const count = await this.dashboardPlugin.regenerateCaches();
              new Notice(`已清除 ${count} 个缓存文件`);
            },
          ), () => { new Notice("缓存维护失败，请检查缓存文件夹权限"); });
        });
      });

    new Setting(containerEl)
      .setName("隔离损坏缓存")
      .setDesc("检查本插件的缓存文件，并将格式损坏的文件改名隔离。")
      .addButton((button) => {
        button.setButtonText("隔离损坏缓存");
        button.buttonEl.setAttribute("aria-label", "确认隔离 Agent Dashboard 损坏缓存");
        button.onClick(() => {
          void this.buttonActions.run(button, () => runConfirmed(
            () => ConfirmationModal.ask(this.app, "隔离损坏缓存？", "只检查当前缓存文件夹中的 Agent Dashboard 缓存。请仅在你信任的本地 Vault 中使用。"),
            async () => {
              const count = await this.dashboardPlugin.quarantineCorruptCaches();
              new Notice(`已隔离 ${count} 个损坏缓存文件`);
            },
          ), () => { new Notice("缓存维护失败，请检查缓存文件夹权限"); });
        });
      });
  }

  private addFolderSetting(name: string, description: string, key: FolderKey): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => {
        text.setValue(this.dashboardPlugin.settings[key]);
        text.inputEl.setAttribute("aria-label", name);
        text.inputEl.addEventListener("change", () => {
          const folder = normalizeVaultRelativeFolder(text.getValue());
          if (folder === null) return void new Notice("请输入安全的 Vault 相对路径");
          void this.commitControl(text, key, folder, (value) => value);
        });
      });
  }

  private addFolderListSetting(
    name: string,
    description: string,
    key: FolderListKey,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addTextArea((area) => {
        area.setValue(this.dashboardPlugin.settings[key].join("\n"));
        area.inputEl.rows = 4;
        area.inputEl.setAttribute("aria-label", name);
        area.inputEl.addEventListener("change", () => {
          const parsed = parseVaultFolderLines(area.getValue());
          if (!parsed.ok) return void new Notice("文件夹路径必须是安全的 Vault 相对路径");
          void this.commitControl(
            area,
            key,
            parsed.folders,
            (folders) => folders.join("\n"),
          ).then((saved) => {
            if (!saved) return;
            this.reportMissingFolders(parsed.folders, key);
            // The next scan picks the new scope up; no Vault file event fires here.
            this.dashboardPlugin.refreshLocalViews();
          });
        });
      });
  }

  /**
   * A folder that does not exist yet is a valid setting (the user may create it
   * later), but it must never fail silently: an unknown task folder collects
   * nothing at all, which reads as "the plugin is broken".
   */
  private reportMissingFolders(folders: readonly string[], key: FolderListKey): void {
    const missing = missingVaultFolders(folders, (path) => {
      const target = this.app.vault.getAbstractFileByPath(path);
      return target !== null && "children" in target;
    });
    if (missing.length === 0) return;
    const consequence = key === "taskIncludeFolders"
      ? "待办列表会为空"
      : "这些文件夹里的复选框不会被排除";
    new Notice(`Vault 中还不存在：${missing.join("、")}（${consequence}）`, 10_000);
  }

  private addGithubSecretSetting(): void {
    let names: string[] | null = null;
    try {
      // eslint-disable-next-line obsidianmd/no-unsupported-api -- Public since 1.11.4; text fallback supports older app versions.
      names = this.app.secretStorage?.listSecrets() ?? null;
    } catch {
      names = null;
    }
    const setting = new Setting(this.containerEl)
      .setName("GitHub 密钥")
      .setDesc("只保存 Obsidian SecretStorage 的密钥名称；令牌本身不会写入插件设置或缓存。");
    if (names !== null) {
      const current = this.dashboardPlugin.settings.githubSecretName;
      setting.addDropdown((dropdown) => {
        dropdown.addOption("", "不使用密钥");
        for (const name of [...new Set([...names ?? [], current])].filter(Boolean).sort()) {
          dropdown.addOption(name, name);
        }
        dropdown.setValue(current);
        dropdown.selectEl.setAttribute("aria-label", "GitHub SecretStorage 密钥名称");
        dropdown.onChange((value) => {
          void this.commitControl(dropdown, "githubSecretName", value, (name) => name);
        });
      });
      return;
    }
    setting.addText((text) => {
      text.setValue(this.dashboardPlugin.settings.githubSecretName);
      text.inputEl.setAttribute("aria-label", "GitHub SecretStorage 密钥名称");
      text.inputEl.addEventListener("change", () => {
        const name = normalizeGithubSecretName(text.getValue());
        if (name === null) return void new Notice("密钥名称只能包含小写字母、数字和连字符");
        void this.commitControl(text, "githubSecretName", name, (value) => value);
      });
    });
  }

  /**
   * 把一次设置改动排进串行队列并落盘。
   *
   * `value` 允许传函数：`{...settings.apiSummarizer, model}` 这类拼装必须等到队列
   * 轮到它时才求值。否则「改完地址马上改模型」的第二次提交会拿事件时刻的旧对象
   * 整体覆盖第一次的改动，地址改动静默丢失（队列外的读-改-写）。
   */
  private async commitControl<K extends keyof AgentDashboardSettings, TDisplay>(
    control: SettingValueControl<TDisplay>,
    key: K,
    value: AgentDashboardSettings[K] | ((current: AgentDashboardSettings[K]) => AgentDashboardSettings[K]),
    display: (value: AgentDashboardSettings[K]) => TDisplay,
  ): Promise<boolean> {
    const result = await this.saveActions.run(async () => {
      const current = this.dashboardPlugin.settings[key];
      const resolved = typeof value === "function" ? value(current) : value;
      const previous = cloneSettingValue(current);
      const saved = await commitControlValue(
        control,
        previous,
        resolved,
        display,
        async (next) => {
          await this.dashboardPlugin.updateSetting(key, next);
          return true;
        },
      );
      if (!saved) new Notice("保存设置失败，已恢复原值");
      return saved;
    }, () => { new Notice("保存设置失败，已恢复原值"); });
    return result === true;
  }
}

export class ConfirmationModal extends Modal {
  private settled = false;
  private resolve!: (confirmed: boolean) => void;

  static ask(app: App, title: string, description: string): Promise<boolean> {
    const modal = new ConfirmationModal(app, title, description);
    const result = new Promise<boolean>((resolve) => { modal.resolve = resolve; });
    modal.open();
    return result;
  }

  private constructor(
    app: App,
    private readonly title: string,
    private readonly description: string,
  ) { super(app); }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: this.title });
    this.contentEl.createEl("p", { text: this.description });
    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText("取消");
        button.buttonEl.setAttribute("aria-label", "取消维护操作");
        button.onClick(() => this.finish(false));
      })
      .addButton((button) => {
        button.setButtonText("确认").setWarning();
        button.buttonEl.setAttribute("aria-label", "确认维护操作");
        button.onClick(() => this.finish(true));
      });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(false);
    }
  }

  private finish(confirmed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(confirmed);
    this.close();
  }
}
