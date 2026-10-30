/**
 * 把 Markdown 正文整成"适合当摘要给人看"的一行文字。
 *
 * 只做最小清理（井号、列表符号、引用符、代码围栏那几行、连续空白），
 * **不**解析链接/强调：摘要里的高亮区间是拿这个结果算的，动得越多，错位的风险越大。
 * 保留语义、不追求排版 —— 摘要是一行预览，不是渲染。
 */
export function toSearchText(markdown: string): string {
  return markdown
    .replace(/^\s*```.*$/gmu, " ")
    // 表格分隔行（| --- | --- |）整行去掉，否则摘要一开头就是一片竖线和短横
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gmu, " ")
    // 剩下表格里的竖线当空格（单元格之间本来就是分隔）
    .replace(/\|/gu, " ")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gmu, "")
    .replace(/^>\s?/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
