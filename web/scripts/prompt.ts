/** 終端機問答（setup、spotify:login 共用）。整段問答共用一個 readline，貼上多行或用管線餵答案都不會漏 */
import { createInterface, type Interface } from 'node:readline';

let rl: Interface | undefined;
let muted = false;
const lines: string[] = [];
const waiting: ((line: string | null) => void)[] = [];
let ended = false;

function session(): Interface {
  if (rl) return rl;
  rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY ?? false });
  const r = rl as unknown as { _writeToOutput: (s: string) => void };
  const write = r._writeToOutput.bind(rl);
  r._writeToOutput = (s: string) => {
    if (!muted || s === '\r\n' || s === '\n') write(s); // hidden：打的字不回顯
  };
  rl.on('line', (l) => (waiting.length ? waiting.shift()!(l) : lines.push(l)));
  rl.on('close', () => {
    ended = true;
    while (waiting.length) waiting.shift()!(null);
  });
  return rl;
}

/** hidden：輸入時不顯示（Client secret 用）；fallback：直接按 Enter 時用的值 */
export async function ask(question: string, opts: { hidden?: boolean; fallback?: string } = {}): Promise<string> {
  session();
  process.stdout.write(question);
  muted = !!opts.hidden;
  const line = lines.length ? lines.shift()! : ended ? null : await new Promise<string | null>((ok) => waiting.push(ok));
  muted = false;
  if (opts.hidden || !process.stdin.isTTY) process.stdout.write('\n');
  if (line === null) throw new Error('輸入中斷，沒有寫入任何檔案');
  return line.trim() || opts.fallback || '';
}

export function closePrompt(): void {
  rl?.close();
  rl = undefined;
}
