"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

const LINKS = [
  { href: "/reception/board", label: "Queue Board" },
  { href: "/reception/checkin", label: "Quick Add" },
  { href: "/reception/control", label: "Control Center" }
];

export function ReceptionNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2">
      {LINKS.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            className={cn(
              "rounded-2xl border px-5 py-2.5 text-[14px] font-semibold transition-all duration-150",
              isActive
                ? "border-[#4f46e5]/45 bg-[linear-gradient(135deg,#6366f1_0%,#4f46e5_55%,#4338ca_100%)] text-white shadow-[0_1px_2px_rgba(16,24,40,0.06),0_12px_24px_-12px_rgba(79,70,229,0.65)]"
                : "border-border/90 bg-white/90 text-muted-foreground hover:border-[#c7d2fe] hover:bg-[#f8faff] hover:text-foreground"
            )}
            href={link.href as never}
            key={link.href}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
