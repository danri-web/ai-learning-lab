/**
 * 文本编码的小工具。
 *
 * 为什么需要：Windows 上「记事本另存」和 PowerShell 的 `Set-Content -Encoding utf8`
 * 都可能给文件**加 UTF-8 BOM**，而 `JSON.parse` 不认 BOM ——
 * 用户手改 `content/tasks.json`（这是本地优先应用**要支持**的用法）就会看到
 * "不是合法 JSON"，然后应用拒绝写入。文件没坏，只是前面多了三个字节。
 *
 * 修法是在解析入口统一剥掉，而不是要求用户"别用 BOM"。
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
