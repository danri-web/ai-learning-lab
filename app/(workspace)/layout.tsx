import { AppShell } from "@/components/layout/app-shell";

/** 工作区路由组：五个页面共用这一层外壳（侧栏 / 顶栏 / 主区）。 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
