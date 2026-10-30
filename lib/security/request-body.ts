/**
 * 登录表单的请求体读取（审计 v5 SEC-02）。
 *
 * `request.formData()` 会把整个请求体先缓冲/解析完；公开的登录路由如果直接调用它，
 * 局域网客户端可以用超大表单把内存/CPU 打满，而且在限速锁定期间也能继续打。
 *
 * 这里在 **流上** 计数：超过上限立即 cancel，返回 null；正常的登录表单只有几百字节。
 */

export const LOGIN_BODY_MAX_BYTES = 8 * 1024;

export function isFormContentType(value: string | null): boolean {
  if (!value) return false;
  const type = value.split(";", 1)[0]?.trim().toLowerCase();
  return type === "application/x-www-form-urlencoded" || type === "multipart/form-data";
}

/**
 * 读取请求体，最多 `maxBytes` 字节。
 * 超过上限（包括 chunked、没有 Content-Length 的情况）返回 null。
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) return null;
  }

  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer as ArrayBuffer;
}
