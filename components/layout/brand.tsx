import Link from "next/link";

/** 侧栏顶部的品牌块。放在 layout 里，不随页面切换。 */
export function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground"
      >
        AI
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-semibold tracking-tight">AI Learning Lab</span>
        <span className="truncate text-[11px] text-muted-foreground">本地学习工作台</span>
      </span>
    </Link>
  );
}
