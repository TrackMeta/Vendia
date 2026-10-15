"use client";

import { Check, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Option = { key: string; label: string; count: number; href: string; active: boolean };

/** «Estado exacto ▾»: para ver un solo estado (por ejemplo solo «En agencia»). */
export function StatusMenu({ options, current }: { options: Option[]; current: string | null }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors md:h-8",
          current ? "border-foreground bg-foreground font-medium text-background" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {current ? `Estado: ${current}` : "Estado exacto"}
        <ChevronDown className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {options.map((o) => (
          <DropdownMenuItem key={o.key} onClick={() => router.push(o.href)} className="flex items-center gap-2">
            <Check className={cn("size-3.5", o.active ? "opacity-100" : "opacity-0")} aria-hidden />
            <span className={cn("flex-1", !o.count && "text-muted-foreground")}>{o.label}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{o.count}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
