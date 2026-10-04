/* eslint-disable obsidianmd/prefer-active-doc -- 浏览器预览页没有 popout 窗口,全局 document 就是它自己的文档。 */
/*
 * 真机预览用的入口(仅开发期人工核对,不参与打包):
 * 直接用插件的渲染函数把整页画进浏览器,样式取仓库里的 styles.css,
 * 素材走 assets/tarot 的真实路径 —— 用来在进 Obsidian 之前先看一眼渲染结果。
 *
 * 用法:
 *   npx esbuild work/preview.ts --bundle --format=iife --target=es2021 `
 *     --alias:crypto=./work/crypto-shim.ts `
 *     --outfile="./harness/preview.js"
 *   然后打开 harness/index.html
 *
 * hash:
 *   #only-fortune / #only-bushi   只留某个板块
 *   #dark / #phone / #narrow      主题与面板宽度
 *   #spread=celtic-cross          卜筮塔罗直接抽这个牌阵
 *   #no-reading                   关掉解牌(对照「本地计算」那一版)
 */
import { loadAlmanacCard } from "../src/features/divination/almanacCard";
import { createXuanxueSessionState } from "../src/features/divination/bushiTypes";
import { loadDailyFortune } from "../src/features/divination/dailyFortune";
import type { DivinationReadingPort } from "../src/features/divination/divinationReading";
import { MOCK_DASHBOARD_STATE } from "../src/data/mockDashboard";
import { renderDashboard } from "../src/view/renderState";

/** 固定时间点:2026-09-30 巳时(与测试、原型同一口径)。 */
const SAMPLE_NOW = new Date(2026, 8, 30, 10, 28);
const ASSET_ROOT = "file:///D:/Obsidian%20Vault/.dev/agent-dashboard/";

function resolveAsset(relativePath: string): string | null {
  const name = relativePath.split("/").pop();
  return name === undefined ? null : `${ASSET_ROOT}${relativePath.replace(/ /g, "%20")}`;
}

/** 示意解牌:真机里这段由设置里配置的模型生成,这里只核对版式。 */
const DAILY_READING = [
  "宝剑二是一张「不动」的牌：两把剑交叉护在胸前，人闭着眼坐在水边，背后是夜与月。它说的不是没有选择，而是两个选项眼下都还站得住。",
  "今天你要处理的，多半是一件「两边都说得通」的事——不是能力不够，而是信息还没凑齐。风元素利于看清、不利于硬撑。",
  "给自己一个明确的截止点，到了就落子；在那之前不必急着表态，但也别把「再等等」当成不出手的借口。",
].join("\n\n");

const SPREAD_READING = [
  "【总断】十张牌里没有一张是「外力」。剑二做现状、杖五逆位压在它上面：真正卡住的不是条件，而是你不愿意把冲突摊到桌面上。",
  "【逐张】",
  "1 现状：僵局。两边都成立，你在等一个能替你决定的信息。",
  "2 交叉/挑战：真正的阻力是「不想把冲突摆上桌」，回避本身在消耗你。",
  "3 根基：不肯先动，是因为手里那点资源舍不得松。",
  "4 近期过去：已经放下过一段旧事，这次不是走不走得开的问题。",
  "5 冠冕：最好的版本是回到一件真心想做的小事上。",
  "6 近期未来：两周内的推力来自「先动起来」。",
  "7 自我态度：你想自己弄清，不太想听意见。",
  "8 外部影响：外部要的是慢慢调和，不奖励急转弯。",
  "9 希望与恐惧：你怕的不是失败，是看错了还硬走。",
  "10 结果：结局偏亮，前提是第 6 张那个动作真的发生。",
  "",
  "【可行】",
  "1. 本周挑一件 30 分钟能做完的小事先做，只为破掉「不动」。",
  "2. 把不愿摊开的那件事用一句话写下来。",
].join("\n");

async function main(): Promise<void> {
  const host = document.getElementById("host");
  if (host === null) return;
  const [fortune, almanac] = await Promise.all([
    loadDailyFortune(SAMPLE_NOW),
    loadAlmanacCard(SAMPLE_NOW),
  ]);
  const session = createXuanxueSessionState();
  // 截「卜筮 · 塔罗」的图,所以直接停在塔罗面板上。
  session.activeMethod = "tarot";
  const readingOff = location.hash.indexOf("no-reading") >= 0;
  const reading: DivinationReadingPort = {
    isConfigured: () => true,
    read: () => Promise.resolve(SPREAD_READING),
  };

  renderDashboard(host, MOCK_DASHBOARD_STATE, {
    updatedAt: MOCK_DASHBOARD_STATE.tasks.updatedAt,
    status: "自动更新完成 · 10:32",
    onNewDiary: () => undefined,
    almanac,
    fortune,
    fortuneReading: readingOff
      ? { status: "idle" }
      : {
          status: "ready",
          text: DAILY_READING,
          meta: "glm-5.3-flash · 10:28 生成",
          onRetry: () => undefined,
        },
    divinationReading: readingOff ? undefined : reading,
    resolveTarotAsset: resolveAsset,
    bushi: { session },
  });

  const wanted = /spread=([a-z-]+)/.exec(location.hash);
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="牌阵"]');
  if (wanted !== null && select !== null) select.value = wanted[1] ?? "single";

  // 看别的卜筮方法的解卦块:#method=liuyao / xiaoliuren / bazi / ziwei …
  const methodWanted = /method=([a-z-]+)/.exec(location.hash);
  if (methodWanted !== null) {
    const tab = host.querySelector<HTMLButtonElement>(
      `.ad-bushi__switcher button[data-method="${methodWanted[1]}"]`,
    );
    tab?.click();
  }

  // 必填的问题栏先填上,否则面板算不出结果(六爻的「所问何事」是必填)。
  for (const label of ["所问何事", "占问(可选)"]) {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (input !== null && input.value === "") input.value = "要不要把这件事摊开谈";
  }

  // 真走一次起卦:算结果 → 画卦象 → 接解卦。
  const submit = host.querySelector<HTMLButtonElement>("button.ad-bp-submit");
  submit?.click();
  window.setTimeout(() => {
    document.body.dataset.ready = "true";
  }, 1200);
}

void main();
