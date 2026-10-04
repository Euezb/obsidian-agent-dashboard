/**
 * 异步请求的「这次还算数吗」计数器。
 *
 * 每个使用方必须持有**自己的实例**：做成模块级单例会让一个面板的起卦把另一个
 * 面板正在进行的计算判成过期，结果被静默丢弃。用法：
 *
 *     const token = requests.next();
 *     void compute()
 *       .then((value) => { if (!requests.isCurrent(token)) return; ... });
 *
 * 只有「发起 → 落盘前比对」这一件事，不碰 DOM、不认识 storage。
 */
export interface RequestToken {
  /** 开始一次新请求，返回本次请求的序号。 */
  next(): number;
  /** 请求收尾时判断自己是否仍是最新的一次。 */
  isCurrent(token: number): boolean;
}

export function createRequestToken(): RequestToken {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      return counter;
    },
    isCurrent: (token) => token === counter,
  };
}
