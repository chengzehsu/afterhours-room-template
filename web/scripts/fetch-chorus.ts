/**
 * profile.json 裡每首曲目 → 向 LRCLIB 查同步歌詞 → 算副歌開始的毫秒 → src/data/chorus.json（{ 曲目id: 毫秒 | null }）。
 * 只存數字，不存歌詞。已經有結果的曲目略過；--force 全部重查。
 * 需要網路：NODE_USE_ENV_PROXY=1 node scripts/fetch-chorus.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChorusMs } from '../src/core/chorus.ts';
import type { TasteProfile } from '../src/core/profile.ts';
import { findLyrics } from '../src/live/lyrics.ts';
import { roomData } from '../src/page/render.ts';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(WEB, 'src/data/chorus.json');
const force = process.argv.includes('--force');

const profile = JSON.parse(readFileSync(resolve(WEB, 'src/data/profile.json'), 'utf8')) as TasteProfile;
const done: Record<string, number | null> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const result: Record<string, number | null> = force ? {} : { ...done };

for (const t of Object.values(roomData(profile).tracks)) {
  if (!force && t.id in done) continue;
  const ly = await findLyrics({ name: t.name, artist: t.artist, durationMs: t.durationMs });
  const ms = ly.kind === 'synced' ? findChorusMs(ly.lines, t.durationMs) : null;
  result[t.id] = ms;
  console.log(`${ms === null ? '  --  ' : (ms / 1000).toFixed(1).padStart(6)}  ${ly.kind.padEnd(12)} ${t.name}`);
  await new Promise((r) => setTimeout(r, 250));
}

const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`寫入 ${OUT}：${Object.values(sorted).filter((v) => v !== null).length}/${Object.keys(sorted).length} 首有副歌秒數`);
