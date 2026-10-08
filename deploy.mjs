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
 * vault 路径是本机信息，不入库：从 work/local-paths.json 读
 * （没有就复制 work/local-paths.example.json 改一改）。
 *
 * 用法：npm run deploy（会先跑一次 npm run build）；node deploy.mjs --dry-run 只看目标。
 */

const PLUGIN_ID = 'agent-dashboard';
/** 发布物：manifest 也一起发，版本号变了要跟着走。 */
const ARTIFACTS = ['main.js', 'manifest.json', 'styles.css'];

const root = import.meta.dirname;

/** vault 根目录列表：本机路径只出现在 work/local-paths.json 里。 */
async function readVaults() {
	const file = path.join(root, 'work', 'local-paths.json');
	let raw;
	try {
		raw = await readFile(file, 'utf8');
	} catch {
		throw new Error(`缺少 ${file} —— 复制 work/local-paths.example.json 改成这台机器的路径再跑。`);
	}
	const parsed = JSON.parse(raw);
	const vaults = (Array.isArray(parsed?.vaults) ? parsed.vaults : [])
		.map((entry) =>
			entry !== null && typeof entry === 'object' && typeof entry.path === 'string' ? entry.path : '')
		.filter((entry) => entry !== '');
	if (vaults.length === 0) throw new Error(`${file} 里没有可用的 vaults[].path。`);
	return vaults;
}

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
	let vaults;
	try {
		vaults = await readVaults();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
		return;
	}
	if (process.argv.includes('--dry-run')) {
		console.log(`试运行：只打印目标，不复制任何文件。vault ${vaults.length} 个：`);
		for (const vault of vaults) console.log(`  ${vault}`);
		return;
	}

	const missing = ARTIFACTS.filter((name) => !existsSync(path.join(root, name)));
	if (missing.includes('main.js') || missing.includes('styles.css')) {
		console.error(`缺少构建产物：${missing.join('、')} —— 先跑 npm run build。`);
		process.exitCode = 1;
		return;
	}

	const backupName = `.backup-${stamp()}`;
	const results = [];
	for (const vault of vaults) {
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
