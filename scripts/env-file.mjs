import { promises as fs } from "node:fs";

/**
 * 极小的 .env 读写（不引 dotenv）。
 *
 * 只支持 `KEY=VALUE` 与 `#` 注释，去掉成对引号；不做变量展开。
 * `.env.local` 已在 .gitignore 里；这里只负责把口令哈希/会话密钥写进去。
 */

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function readEnvFile(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }

  const values = new Map();
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values.set(match[1], unquote(match[2]));
  }
  return values;
}

export async function readEnvText(filePath) {
  try {
    return (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

/** 保留其它行；同名键就地替换；没有的追加到末尾 */
export function upsertEnv(text, values) {
  const pending = new Map(Object.entries(values));
  const lines = text.length > 0 ? text.replace(/\r?\n$/, "").split(/\r?\n/) : [];

  const next = lines.map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match) return line;
    const key = match[1];
    if (!pending.has(key)) return line;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of pending) next.push(`${key}=${value}`);
  return `${next.join("\n")}\n`;
}

export async function writeEnvValues(filePath, values) {
  const text = await readEnvText(filePath);
  await fs.writeFile(filePath, upsertEnv(text, values), "utf8");
}
