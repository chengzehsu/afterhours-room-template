/** 頁面上的「分享」按鈕：瀏覽器端。純函式（回饋文字、資料驗證）可測，DOM 部分在 initShare。 */

export interface ShareData { url: string; story: string; filename: string }
export type ShareResult = { via: 'share' | 'download' | 'cancelled'; copied: boolean };

/** 按鈕旁的提示文字；取消分享不顯示任何字 */
export function shareNote(r: ShareResult): string {
  if (r.via === 'cancelled') return '';
  if (r.via === 'share') return r.copied ? '連結已複製，可以貼在 IG 的連結貼紙' : '圖已分享，連結請從網址列複製';
  return r.copied ? '圖已下載，連結已複製' : '圖已下載';
}

/** share-data 只收 https 網址與站內相對圖路徑，避免頁面被塞奇怪的值 */
export function parseShareData(json: string): ShareData | null {
  try {
    const v = JSON.parse(json) as Partial<ShareData>;
    if (typeof v.url !== 'string' || !/^https:\/\//.test(v.url)) return null;
    if (typeof v.story !== 'string' || !/^(\.\.\/)?[\w-]+(\/(?!\.)[\w.-]+)+$/.test(v.story)) return null;
    if (typeof v.filename !== 'string' || !/^[\w.-]+$/.test(v.filename)) return null;
    return { url: v.url, story: v.story, filename: v.filename };
  } catch { return null; }
}

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function initShare(): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-share]')];
  const raw = document.getElementById('share-data')?.textContent;
  const data = raw ? parseShareData(raw) : null;
  if (!buttons.length || !data) return;
  // 圖要的是同一個網站的相對路徑；從頁面所在資料夾算，放映室在 /screening/ 底下
  const imageUrl = new URL(data.story, document.baseURI).href;
  let blobP: Promise<Blob> | null = null;
  const load = () => (blobP ??= fetch(imageUrl).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }).catch((e) => { blobP = null; throw e; }));
  for (const btn of buttons) {
    btn.hidden = false;
    const note = btn.parentElement?.querySelector<HTMLElement>('[data-share-note]') ?? null;
    const say = (t: string) => { if (note) note.textContent = t; };
    btn.addEventListener('pointerenter', () => { load().catch(() => {}); }, { once: true });
    btn.addEventListener('focus', () => { load().catch(() => {}); }, { once: true });
    btn.addEventListener('click', async () => {
      // 複製要在點擊當下同步呼叫，等圖片回來就太晚（瀏覽器會當成沒有手勢）
      const copying = copy(data.url);
      btn.disabled = true;
      try {
        const blob = await load();
        const file = new File([blob], data.filename, { type: blob.type || 'image/jpeg' });
        const copied = await copying;
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file] });
            say(shareNote({ via: 'share', copied }));
          } catch (e) {
            say(e instanceof DOMException && e.name === 'AbortError' ? shareNote({ via: 'cancelled', copied }) : '分享沒成功，請再試一次');
          }
        } else {
          const a = document.createElement('a');
          const href = URL.createObjectURL(blob);
          a.href = href; a.download = data.filename;
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(href), 10_000);
          say(shareNote({ via: 'download', copied }));
        }
      } catch {
        say('圖片沒載入，請再試一次');
      } finally {
        btn.disabled = false;
      }
    });
  }
}
