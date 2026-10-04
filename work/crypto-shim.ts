/*
 * 浏览器预览用的 crypto 垫片 —— 只服务 work/preview.ts,不进插件产物。
 *
 * taibu-core 的种子函数要 sha256(Obsidian 里是 Electron 的 Node crypto,正常工作);
 * 浏览器里没有这个模块,这里用一个确定性的乘法哈希顶上:
 * 牌号会与真机不同,但「牌面怎么画、牌阵怎么排」完全相同,预览的目的就是看版式。
 */
class PreviewHash {
	private value = 2166136261;

	update(input: string): this {
		for (let index = 0; index < input.length; index += 1) {
			this.value = Math.imul(this.value ^ input.charCodeAt(index), 16777619) >>> 0;
		}
		return this;
	}

	digest(encoding?: string): unknown {
		const bytes = new Uint8Array(32);
		let state = this.value;
		for (let index = 0; index < bytes.length; index += 1) {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			bytes[index] = state & 0xff;
		}
		if (encoding === "hex") {
			return Array.from(bytes)
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
		}
		return {
			readUInt32BE: (offset: number): number =>
				(((bytes[offset] ?? 0) << 24) |
					((bytes[offset + 1] ?? 0) << 16) |
					((bytes[offset + 2] ?? 0) << 8) |
					(bytes[offset + 3] ?? 0)) >>>
				0,
		};
	}
}

export function createHash(): PreviewHash {
	return new PreviewHash();
}

export default { createHash };
