import { describe, expect, it } from "vitest";

import {
  LOGIN_BODY_MAX_BYTES,
  isFormContentType,
  readBodyWithLimit,
} from "@/lib/security/request-body";

const URL_ = "http://127.0.0.1:3000/api/auth/login";
const FORM = "application/x-www-form-urlencoded";

function request(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: "POST",
    headers: { "content-type": FORM, ...headers },
    body,
  });
}

describe("登录请求体上限（SEC-02）", () => {
  it("正常表单能读完并还原成 FormData", async () => {
    const source = new URLSearchParams({ password: "correct horse", next: "/knowledge" });
    const bytes = await readBodyWithLimit(request(source.toString()), LOGIN_BODY_MAX_BYTES);
    expect(bytes).not.toBeNull();
    if (!bytes) return;

    const form = await new Response(bytes, {
      headers: { "content-type": FORM },
    }).formData();
    expect(form.get("password")).toBe("correct horse");
    expect(form.get("next")).toBe("/knowledge");
  });

  it("Content-Length 声明超限时直接拒绝", async () => {
    const req = request("x", { "content-length": String(LOGIN_BODY_MAX_BYTES + 1) });
    expect(await readBodyWithLimit(req, LOGIN_BODY_MAX_BYTES)).toBeNull();
  });

  it("没有 Content-Length 的 chunked 流也会在超限时截断", async () => {
    const chunk = new Uint8Array(1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 9 KB：超过 8 KB 上限
        for (let index = 0; index < 9; index += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    const req = new Request(URL_, {
      method: "POST",
      headers: { "content-type": FORM },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    expect(await readBodyWithLimit(req, LOGIN_BODY_MAX_BYTES)).toBeNull();
  });

  it("只接受表单 content-type", () => {
    expect(isFormContentType(FORM)).toBe(true);
    expect(isFormContentType(`${FORM}; charset=UTF-8`)).toBe(true);
    expect(isFormContentType("multipart/form-data; boundary=x")).toBe(true);
    expect(isFormContentType("application/json")).toBe(false);
    expect(isFormContentType(null)).toBe(false);
  });
});
