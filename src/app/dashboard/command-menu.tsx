"use client";

import { Loader2, Search, ShoppingBag, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { OrderStatusBadge } from "@/components/dashboard/status-badge";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { displayPhone } from "@/modules/country";
import { HELP_ITEM, visibleGroups } from "./nav";
import { quickSearch, type SearchResult } from "./search-actions";

const EMPTY: SearchResult = { orders: [], customers: [] };
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Botón «Buscar…» que abre el buscador. Variante oscura para el menú grafito. */
export function SearchButton({ onOpen, className, compact }: { onOpen: () => void; className?: string; compact?: boolean }) {
  if (compact) {
    return (
      <button type="button" onClick={onOpen} aria-label="Buscar" className={cn("rounded-md p-2 hover:bg-muted", className)}>
        <Search className="size-5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
        className,
      )}
    >
      <Search className="size-4" />
      <span className="flex-1 text-left">Buscar…</span>
      <kbd className="rounded border border-white/15 px-1.5 font-sans text-[10px] text-muted-foreground">Ctrl K</kbd>
    </button>
  );
}

/**
 * Buscador rápido (Ctrl+K o «/»): pedidos por teléfono, nombre o número; clientes; y secciones del panel.
 * Pensado para cuando un cliente llama: escribes su número y abres su pedido en un segundo.
 */
export function CommandMenu({ open, onOpenChange, isOwner }: { open: boolean; onOpenChange: (open: boolean) => void; isOwner: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult>(EMPTY);
  const [pending, startTransition] = useTransition();
  const lastQuery = useRef("");

  // Atajos: Ctrl/Cmd+K en cualquier lugar; «/» cuando no se está escribiendo en un campo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  // Búsqueda en el servidor con una pequeña espera para no consultar en cada tecla
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    const t = setTimeout(() => {
      lastQuery.current = term;
      startTransition(async () => {
        const r = await quickSearch(term);
        if (lastQuery.current === term) setResults(r);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  const go = (href: string) => {
    onOpenChange(false);
    setQuery("");
    setResults(EMPTY);
    router.push(href);
  };

  const term = fold(query.trim());
  const searching = term.length >= 2;
  const shown = searching ? results : EMPTY;
  const sections = [...visibleGroups(isOwner).flatMap((g) => g.items), HELP_ITEM].filter(
    (i) => !term || fold(`${i.label} ${i.keywords ?? ""}`).includes(term),
  );
  const nothing = searching && !pending && !shown.orders.length && !shown.customers.length && !sections.length;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Buscar" description="Busca pedidos, clientes o secciones" className="sm:max-w-lg">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Teléfono, nombre o n.º de pedido…" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[60vh]">
          {pending ? (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Buscando…
            </p>
          ) : null}
          {nothing ? <CommandEmpty>No encontramos nada con «{query.trim()}».</CommandEmpty> : null}
          {shown.orders.length ? (
            <CommandGroup heading="Pedidos">
              {shown.orders.map((o) => (
                <CommandItem key={o.id} value={`order-${o.id}`} onSelect={() => go(`/dashboard/pedidos/${o.id}`)}>
                  <ShoppingBag className="text-muted-foreground" />
                  <span className="w-14 shrink-0 font-medium tabular-nums">#{o.order_number}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{o.customer_name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{displayPhone(o.customer_phone)}</span>
                  </span>
                  <span className="hidden text-xs tabular-nums sm:inline">{formatMoney(o.total)}</span>
                  <OrderStatusBadge status={o.status} />
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {shown.customers.length ? (
            <CommandGroup heading="Clientes">
              {shown.customers.map((c) => (
                <CommandItem key={c.id} value={`customer-${c.id}`} onSelect={() => go(`/dashboard/clientes/${c.id}`)}>
                  <User className="text-muted-foreground" />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{displayPhone(c.phone)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {sections.length ? (
            <CommandGroup heading="Ir a">
              {sections.map((i) => (
                <CommandItem key={i.href} value={`nav-${i.href}`} onSelect={() => go(i.href)}>
                  <i.icon className="text-muted-foreground" />
                  {i.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          Abre el buscador con <kbd className="font-sans font-medium">Ctrl K</kbd> o <kbd className="font-sans font-medium">/</kbd> desde cualquier pantalla.
        </p>
      </Command>
    </CommandDialog>
  );
}
