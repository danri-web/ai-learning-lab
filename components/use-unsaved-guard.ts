"use client";

import { useEffect } from "react";

/**
 * 未保存提醒（审计 v5 QA-02）。
 *
 * 只挡 `beforeunload` 不够：侧栏/顶栏是 Next 的 `<Link>`，属于 SPA 内部跳转，
 * 浏览器不会触发 beforeunload。这里在 document 捕获阶段拦内部 `<a>`：
 * 有脏数据时先 `confirm`，用户取消就阻止这次跳转。
 *
 * 不处理：浏览器后退/前进（App Router 没有可取消的路由事件）、外链、新标签页、下载。
 * 这些边界写在这里，避免以后误以为“全挡了”。
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 老浏览器靠 returnValue 才弹；现代浏览器忽略它但需要被赋值
      event.returnValue = "";
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      if (window.confirm("有未保存的修改，确定离开这一页吗？")) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
