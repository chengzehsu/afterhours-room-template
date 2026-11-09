/** 「晚風樂團 Evening Breeze」這種中英並列的名字只留中文；其他照原樣 */
export function displayName(name: string): string {
  const m = name.match(/^([一-鿿㐀-䶿]+)\s+[A-Za-z]/);
  return m ? m[1]! : name;
}
