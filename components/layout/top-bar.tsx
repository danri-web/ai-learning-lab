"use client";

import { Menu, Plus, Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";

/**
 * 顶栏。阶段 2 只做骨架：
 * - 手机端的导航抽屉（可 Esc 关闭、焦点被 Sheet 管住）
 * - 搜索与新建是**禁用**的占位，按钮上写清哪个阶段启用，不做假功能
 */
export function TopBar() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur md:px-6">
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="打开导航菜单">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 gap-0 p-0">
          <SheetTitle className="sr-only">导航菜单</SheetTitle>
          <SheetDescription className="sr-only">
            在总览、知识库、资源、学习任务、设置之间切换
          </SheetDescription>
          <div className="flex h-full flex-col">
            <Brand onNavigate={() => setNavOpen(false)} />
            <SidebarNav onNavigate={() => setNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <span className="text-sm font-semibold tracking-tight md:hidden">AI Learning Lab</span>

      {/* 阶段 5 会把这里换成真的搜索弹窗（Ctrl+K） */}
      <div className="ml-auto hidden w-full max-w-md items-center gap-2 md:ml-0 md:flex">
        <div className="relative w-full">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            disabled
            placeholder="搜索笔记与资源（阶段 5 启用）"
            aria-label="搜索（阶段 5 启用）"
            className="h-8 w-full cursor-not-allowed rounded-md border border-input bg-surface pr-16 pl-9 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-70"
          />
          <kbd
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border bg-elevated px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            Ctrl K
          </kbd>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 md:ml-0">
        <Button
          variant="outline"
          size="sm"
          disabled
          title="阶段 3 启用：新建笔记"
          className="gap-1.5"
        >
          <Plus aria-hidden />
          <span className="hidden sm:inline">新建笔记</span>
        </Button>
      </div>
    </header>
  );
}
