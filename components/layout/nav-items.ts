import {
  Archive,
  BookOpen,
  LayoutDashboard,
  Library,
  ListChecks,
  Settings,
  type LucideIcon,
} from "lucide-react";

/**
 * 主导航的唯一来源。侧栏、手机抽屉、以及 tests/nav.test.ts 都读这一份，
 * 所以「导航项指向的页面不存在」会在测试里直接失败。
 */
export type NavItem = {
  /** 路由，同时也是页面文件位置的依据（见 tests/nav.test.ts） */
  href: string;
  /** 界面上的主标签（中文） */
  label: string;
  /** 需求书里的页面名（英文），显示为副标签 */
  en: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "总览", en: "Dashboard", icon: LayoutDashboard },
  { href: "/knowledge", label: "知识库", en: "Knowledge", icon: BookOpen },
  { href: "/resources", label: "资源收藏", en: "Resources", icon: Library },
  { href: "/learning", label: "学习任务", en: "Learning", icon: ListChecks },
  { href: "/backup", label: "备份", en: "Backup", icon: Archive },
  { href: "/settings", label: "设置", en: "Settings", icon: Settings },
];

/** 当前路径是否命中某个导航项（"/" 必须精确匹配，否则永远命中） */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
