import { NextResponse } from "next/server";

import { downloadBackup } from "@/features/backup/service";
import { requireAuth } from "@/lib/security/auth";

/**
 * 下载一份备份（导出）。
 *
 * Route Handler 不经过工作区布局，所以这里显式走 service 的 `requireAuth()`；
 * proxy 也会先挡一次。名字只认 backups/ 里的时间戳格式，路径校验在 backup-store。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  await requireAuth();

  const { name: raw } = await context.params;
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // 保持原样，交给名字格式校验去拒绝
  }

  const result = await downloadBackup(name);
  if (!result.ok) {
    return new NextResponse(result.error, {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${result.name}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
