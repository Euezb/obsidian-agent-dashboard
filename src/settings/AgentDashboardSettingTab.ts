/* eslint-disable obsidianmd/ui/sentence-case -- Chinese UI preserves product names and standard acronyms. */
import { Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type { App, TextComponent } from "obsidian";
import type AgentDashboardPlugin from "../main";
import type { AgentDashboardSettings } from "./settings";
import { runConfirmed } from "./CacheMaintenance";
import { SafeActionQueue, SafeButtonActionRunner } from "./SafeActionQueue";
import {
  commitControlValue,
  type SettingValueControl,
} from "./SettingControlPersistence";
import {
  normalizeCodexExecutableInput,
  normalizeGithubSecretName,
  normalizeTtlMinutes,
  normalizeVaultRelativeFolder,
  parseRssFeedLines,
} from "./settingsValidation";

type FolderKey = "dailyFolder" | "inboxFolder" | "reportsFolder" | "cacheFolder";

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
    this.addFolderSetting("报告文件夹", "Codex 研究报告的保存路径。", "reportsFolder");
    this.addFolderSetting("缓存文件夹", "Codex 工作文件（资讯源、提示词）的 Vault 相对路径；榜单与摘要缓存保存在插件数据目录，不占用同步空间。修改后请重启 Obsidian。", "cacheFolder");

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
          const current = this.dashboardPlugin.settings.rssFeeds;
          if (current.includes(url)) {
            new Notice(`${label} 已在订阅列表中`);
            return;
          }
          void this.dashboardPlugin.updateSetting("rssFeeds", [...current, url]).then(() => {
            new Notice(`已添加订阅：${label}，重新打开设置可看到更新`);
          }).catch(() => {
            new Notice("保存设置失败");
          });
        });
      });
    }

    new Setting(containerEl).setName("Codex 摘要").setHeading();
    new Setting(containerEl)
      .setName("自动生成每日摘要")
      .setDesc("每天首次获得新资讯后自动运行一次 Codex；失败不会在当天反复运行。")
      .addToggle((toggle) => {
        toggle.setValue(this.dashboardPlugin.settings.autoDailyCodexSummary);
        toggle.toggleEl.setAttribute("aria-label", "自动生成每日摘要");
        toggle.onChange((value) => {
          void this.commitControl(toggle, "autoDailyCodexSummary", value, (enabled) => enabled);
        });
      });

    let codexInput: TextComponent;
    new Setting(containerEl)
      .setName("Codex 可执行文件")
      .setDesc("填写 codex，或填写本机绝对 .exe 路径。不会执行自定义命令。")
      .addText((text) => {
        codexInput = text;
        text.setValue(this.dashboardPlugin.settings.codexExecutable);
        text.inputEl.setAttribute("aria-label", "Codex 可执行文件路径");
        text.inputEl.addEventListener("change", () => {
          const executable = normalizeCodexExecutableInput(text.getValue());
          if (executable === null) return void new Notice("Codex 路径无效，设置未保存");
          void this.commitControl(text, "codexExecutable", executable, (value) => value);
        });
      })
      .addButton((button) => {
        button.setButtonText("检测 Codex");
        button.buttonEl.setAttribute("aria-label", "检测 Codex 版本");
        button.onClick(() => {
          void this.buttonActions.run(button, async () => {
            const executable = normalizeCodexExecutableInput(codexInput.getValue());
            if (executable === null) return void new Notice("Codex 路径无效");
            if (!await this.commitControl(
              codexInput,
              "codexExecutable",
              executable,
              (value) => value,
            )) return;
            const version = await this.dashboardPlugin.detectCodex();
            new Notice(`Codex 可用：${version}`);
          }, () => { new Notice("Codex 检测失败：未检测到可用的 Codex CLI"); });
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

  private async commitControl<K extends keyof AgentDashboardSettings, TDisplay>(
    control: SettingValueControl<TDisplay>,
    key: K,
    value: AgentDashboardSettings[K],
    display: (value: AgentDashboardSettings[K]) => TDisplay,
  ): Promise<boolean> {
    const result = await this.saveActions.run(async () => {
      const previous = cloneSettingValue(this.dashboardPlugin.settings[key]);
      const saved = await commitControlValue(
        control,
        previous,
        value,
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

function cloneSettingValue<T>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
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
