import { copyFile, lstat, mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * 把构建产物发到各个 Obsidian vault 的插件目录。
 *
 * 为什么每个 vault 各留一份独立副本，而不是软链到同一处：
 * 插件目录里的 data.json 是那个 vault 自己的设置（文件夹名、列宽、开关都不一样），
 * 软链会让两个 vault 共用同一份设置、互相覆盖。所以只能是「一次构建、多处复制」——
 * 那就要有个地方把「多处」记下来，免得又出现「改了但只改了一半」。
 *
 * 用法：npm run deploy（会先跑一次 npm run build）。
 */
const VAULTS = [
	'<vault A>',
	'<vault B>',
];

const PLUGIN_ID = 'agent-dashboard';
/** 发布物：manifest 也一起发，版本号变了要跟着走。 */
const ARTIFACTS = ['main.js', 'manifest.json', 'styles.css'];

const root = import.meta.dirname;

function stamp(now = new Date()) {
	const pad = (value) => String(value).padStart(2, '0');
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

async function sha256(file) {
	return createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 12);
}

async function sizeOf(file) {
	try {
		return (await stat(file)).size;
	} catch {
		return 0;
	}
}

async function deployTo(vault, backupName) {
	const target = path.join(vault, '.obsidian', 'plugins', PLUGIN_ID);
	if (!existsSync(target)) {
		return { vault, status: '未安装，跳过' };
	}

	// 目录本身若是软链/联接，写进去的其实是别处的文件 —— 那就不该按「独立副本」处理。
	// 必须用 lstat：stat 会跟随链接，永远看不出它是链接。
	const targetStat = await lstat(target);
	if (targetStat.isSymbolicLink()) {
		return { vault, status: '插件目录是软链，拒绝覆盖（请先手动处理）' };
	}

	const backup = path.join(target, backupName);
	await mkdir(backup, { recursive: true });
	for (const name of ARTIFACTS) {
		const current = path.join(target, name);
		if (existsSync(current)) await copyFile(current, path.join(backup, name));
	}

	const copied = [];
	for (const name of ARTIFACTS) {
		const source = path.join(root, name);
		if (!existsSync(source)) continue;
		await copyFile(source, path.join(target, name));
		copied.push(name);
	}

	return {
		vault,
		status: `已更新 ${copied.join(' + ')}`,
		backup,
		hash: await sha256(path.join(target, 'main.js')),
		size: await sizeOf(path.join(target, 'main.js')),
	};
}

async function main() {
	const missing = ARTIFACTS.filter((name) => !existsSync(path.join(root, name)));
	if (missing.includes('main.js') || missing.includes('styles.css')) {
		console.error(`缺少构建产物：${missing.join('、')} —— 先跑 npm run build。`);
		process.exitCode = 1;
		return;
	}

	const backupName = `.backup-${stamp()}`;
	const results = [];
	for (const vault of VAULTS) {
		results.push(await deployTo(vault, backupName));
	}

	console.log(`\n发布物：${ARTIFACTS.join('、')}（备份目录名 ${backupName}）`);
	for (const result of results) {
		const detail = result.hash === undefined
			? ''
			: `  main.js ${result.size} bytes  sha256:${result.hash}`;
		console.log(`  ${result.vault}\n    ${result.status}${detail}`);
	}
	const failed = results.filter((result) => result.status.startsWith('插件目录是软链'));
	if (failed.length > 0) process.exitCode = 1;
}

await main();
