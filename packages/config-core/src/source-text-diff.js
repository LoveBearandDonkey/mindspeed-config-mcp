const MAX_CELLS = 40_000;
const MAX_OUTPUT_CHARS = 24_000;

export function sourceTextDiff(beforeText, afterText) {
  const before = beforeText.replaceAll("\r\n", "\n").split("\n");
  const after = afterText.replaceAll("\r\n", "\n").split("\n");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start
    && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const oldLines = before.slice(start, beforeEnd);
  const newLines = after.slice(start, afterEnd);
  if (!oldLines.length && !newLines.length) return { format: "unified", text: "", complete: true };
  const lines = [`@@ -${start + 1},${oldLines.length} +${start + 1},${newLines.length} @@`];
  let complete = true;
  if (oldLines.length + newLines.length > 1_000
    || oldLines.length * newLines.length > MAX_CELLS) {
    complete = false;
    lines.push("# 差异过大，仅展示变更块；请在工程中查看完整 git diff。",
      ...oldLines.slice(0, 80).map((line) => `-${line}`),
      ...newLines.slice(0, 80).map((line) => `+${line}`));
  } else {
    const dp = Array.from({ length: oldLines.length + 1 }, () =>
      new Uint32Array(newLines.length + 1));
    for (let i = oldLines.length - 1; i >= 0; i -= 1) {
      for (let j = newLines.length - 1; j >= 0; j -= 1) {
        dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        lines.push(` ${oldLines[i]}`); i += 1; j += 1;
      } else if (i < oldLines.length && (j === newLines.length || dp[i + 1][j] >= dp[i][j + 1])) {
        lines.push(`-${oldLines[i]}`); i += 1;
      } else { lines.push(`+${newLines[j]}`); j += 1; }
    }
  }
  let text = lines.join("\n");
  if (text.length > MAX_OUTPUT_CHARS) {
    text = `${text.slice(0, MAX_OUTPUT_CHARS)}\n# 已截断；请在工程中查看完整 git diff。`;
    complete = false;
  }
  return { format: "unified", text, complete };
}
