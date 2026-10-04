import { FileSystemAdapter, type App } from "obsidian";
import type { TarotAssetResolver } from "../features/divination/tarotFace";

/**
 * 插件内置素材(assets/tarot/)→ 能放进 <img src> 的地址。
 *
 * 走 FileSystemAdapter.getResourcePath —— Obsidian 给本地文件的公开入口,
 * 不需要把图片塞进 main.js,也不需要在运行时联网。
 * 非文件系统 Vault(移动端、纯浏览器)拿不到地址,返回 null,
 * 牌面会降级成写着牌名的占位牌而不是留白。
 */
export function createTarotAssetResolver(
  app: App,
  pluginDir: string | undefined,
): TarotAssetResolver {
  return (relativePath: string): string | null => {
    if (pluginDir === undefined || pluginDir === "") return null;
    const adapter = app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return null;
    try {
      return adapter.getResourcePath(`${pluginDir}/${relativePath}`);
    } catch {
      return null;
    }
  };
}
