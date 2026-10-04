/**
 * 递归拷贝设置值（对象 / 数组 / 原始值）。
 *
 * 只做一层浅拷贝是不够的：`apiSummarizer` 这类嵌套对象会在「永远整体替换顶层键」
 * 的隐含约定之外被就地改动，设置回滚与持久化快照的语义就都失效了（审查 D8）。
 * 非纯数据（函数、Date 等）原样返回——设置里没有这类值，真出现了也不该被悄悄
 * 转成普通对象。
 */
export function cloneSettingValue<T>(value: T): T {
  if (Array.isArray(value)) {
    const entries: readonly unknown[] = value as readonly unknown[];
    return entries.map((entry) => cloneSettingValue(entry)) as unknown as T;
  }
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = cloneSettingValue(entry);
    }
    return copy as T;
  }
  return value;
}
