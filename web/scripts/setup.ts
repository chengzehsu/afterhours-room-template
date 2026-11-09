/**
 * npm run setup：問名字、別名、Worker 名稱、網址，寫進 web/src/data/owner.json 與 web/site.config.json。
 * 只改這幾個欄位，其他內容（最愛清單等）原樣保留；不碰任何權杖。
 * 不想用問答的話：npm run setup -- --name 小明 --alias Ming --worker ming-room --url https://ming-room.ming.workers.dev
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ask, closePrompt } from './prompt.ts';

export interface Answers { name: string; alias: string; worker: string; url: string }

/** Cloudflare Worker 名稱：小寫英數與 -，開頭結尾不能是 -，最多 63 字 */
export const validWorker = (w: string) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(w);

/** 網址：完整 https 網址照用；只填一個詞就當作 workers.dev 子網域 */
export function toUrl(input: string, worker: string): string | null {
  const v = input.trim().replace(/\/+$/, '');
  if (/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(v)) return v;
  if (/^[a-z0-9-]+$/i.test(v)) return `https://${worker}.${v.toLowerCase()}.workers.dev`;
  return null;
}

export function applySetup(web: string, a: Answers): void {
  if (!a.name.trim()) throw new Error('名字不能空白');
  if (!validWorker(a.worker)) throw new Error(`Worker 名稱「${a.worker}」不行：只能用小寫英文、數字和 -`);
  const url = toUrl(a.url, a.worker);
  if (!url) throw new Error(`網址「${a.url}」不行：填完整的 https 網址，或只填 workers.dev 子網域`);
  const ownerFile = resolve(web, 'src/data/owner.json');
  const owner = existsSync(ownerFile) ? JSON.parse(readFileSync(ownerFile, 'utf8')) : {};
  owner.name = a.name.trim();
  if (a.alias.trim()) owner.alias = a.alias.trim();
  else delete owner.alias;
  writeFileSync(ownerFile, JSON.stringify(owner, null, 2) + '\n');
  writeFileSync(resolve(web, 'site.config.json'), JSON.stringify({ url, worker: a.worker }, null, 2) + '\n');
}

async function main(): Promise<void> {
  const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { values: f } = parseArgs({ options: { name: { type: 'string' }, alias: { type: 'string' }, worker: { type: 'string' }, url: { type: 'string' } } });
  const read = (f: string) => (existsSync(resolve(web, f)) ? JSON.parse(readFileSync(resolve(web, f), 'utf8')) : {});
  const owner = read('src/data/owner.json');
  const site = read('site.config.json');
  const keep = (v: string | undefined) => (v && !/your-room|your-subdomain/.test(v) ? v : undefined);
  const hint = (v: string | undefined) => (v ? `（Enter 保留「${v}」）` : '');

  console.log('設定你的播放室（直接按 Enter 保留目前的值）\n');
  const name = f.name ?? (await ask(`1/4 名牌上的名字，例如「小明」${hint(owner.name)}：`, { fallback: owner.name }));
  const alias = f.alias ?? (await ask(`2/4 別名，開場會說「也可以叫我 …」，不要別名就輸入 -${hint(owner.alias)}：`, { fallback: owner.alias ?? '' }));
  let worker = f.worker ?? '';
  while (!validWorker(worker)) {
    if (worker) console.log('   只能用小寫英文、數字和 -，再試一次');
    worker = await ask(`3/4 Cloudflare Worker 名稱，也是網址的開頭，例如 ming-room${hint(keep(site.worker))}：`, { fallback: keep(site.worker) ?? '' });
  }
  let url = f.url ?? '';
  while (!toUrl(url, worker)) {
    if (url) console.log('   填完整的 https 網址，或只填 workers.dev 子網域，再試一次');
    url = await ask(`4/4 網址：用 Cloudflare 的話填你的 workers.dev 子網域（Cloudflare 後台 Workers 頁看得到，例如 ming），有自己的網域就填完整網址${hint(keep(site.url))}：`, { fallback: keep(site.url) ?? '' });
  }
  closePrompt();
  applySetup(web, { name, alias: alias === '-' ? '' : alias, worker, url });
  console.log(`\n已寫入 web/src/data/owner.json 與 web/site.config.json\n網址：${toUrl(url, worker)}\n\n接著跑 npm run doctor 看下一步。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
