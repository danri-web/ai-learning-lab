"use client";

import { Menu, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SearchCommand } from "@/components/search/search-command";
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
 * 顶栏：
 * - 手机端的导航抽屉（可 Esc 关闭、焦点被 Sheet 管住）
 * - 搜索在阶段 5 接上了真的弹窗（Ctrl+K；手机上是图标按钮）
 * - 「新建笔记」在阶段 3b 接上了真页面
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

      {/* 阶段 5：真的搜索弹窗（Ctrl+K，手机上是图标按钮） */}
      <div className="ml-auto flex min-w-0 flex-1 items-center gap-2 md:ml-0 md:max-w-md">
        <SearchCommand />
      </div>

      <div className="ml-auto flex items-center gap-2 md:ml-0">
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href="/knowledge/new">
            <Plus aria-hidden />
            <span className="hidden sm:inline">新建笔记</span>
            <span className="sr-only sm:hidden">新建笔记</span>
          </Link>
        </Button>
      </div>
    </header>
  );
}
