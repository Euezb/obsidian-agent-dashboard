import { createRequestToken, type RequestToken } from "../../infrastructure/requestToken";

/**
 * 每个面板 storage 一份请求令牌。
 *
 * 为什么不放在 render 闭包里：一次重渲染就会重建闭包。仅仅「每 render 一份」的话，
 * 重渲染之前发起的那次排盘无法被重渲染之后的新排盘判成过期，旧响应照样可能盖掉
 * 新结果（连点两次之间只要夹进一次状态推送就会发生）。storage 对象跨渲染稳定，
 * 用 WeakMap 挂在它上面既看得见全部在途请求，也不会留下引用。
 */
const tokens = new WeakMap<object, RequestToken>();

export function requestTokenFor(storage: object): RequestToken {
  const existing = tokens.get(storage);
  if (existing !== undefined) return existing;
  const created = createRequestToken();
  tokens.set(storage, created);
  return created;
}
