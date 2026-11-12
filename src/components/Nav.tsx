"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Clapperboard, LayoutDashboard, Radar, Settings, Sparkles } from "lucide-react";
import { cx } from "./ui";

const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trends", label: "Trend Radar", icon: Radar },
  { href: "/videos", label: "Meine Videos", icon: Clapperboard },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Einstellungen", icon: Settings },
];

export function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/create") : path.startsWith(href) || (href === "/videos" && path.startsWith("/projects")));
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-stone-200/80 bg-white/70 px-4 py-6 backdrop-blur lg:flex">
        <Link href="/" className="mb-8 flex items-center gap-2.5 px-2">
          <span className="grid size-9 place-items-center rounded-xl bg-accent text-white"><Sparkles className="size-5" aria-hidden /></span>
          <span className="text-[15px] font-semibold tracking-tight">Viral AI Studio</span>
        </Link>
        <nav className="flex flex-col gap-1" aria-label="Hauptnavigation">
          {items.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} className={cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition", active(href) ? "bg-accent-soft text-violet-800" : "text-stone-600 hover:bg-stone-100")}>
              <Icon className="size-[18px]" aria-hidden />{label}
            </Link>
          ))}
        </nav>
      </aside>
      <nav aria-label="Hauptnavigation" className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {items.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} className={cx("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium", active(href) ? "text-accent" : "text-stone-500")}>
            <Icon className="size-5" aria-hidden />{label.split(" ").pop()}
          </Link>
        ))}
      </nav>
    </>
  );
}
