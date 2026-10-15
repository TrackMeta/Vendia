"use client";

import { Bell, BellRing, Check, ShoppingBag, Trash2, Volume2, VolumeX, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { playNotificationSound, playSound } from "@/modules/notifications/sound";
import { useSoundPrefs } from "./sound-settings";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read?: boolean;
};

export const ORDERS_CHANGED_EVENT = "vendia:orders-changed";
/** Se marcaron como leídas o se borraron notificaciones (p. ej. desde la página Notificaciones): la campanita se pone al día. */
export const NOTIFICATIONS_CHANGED_EVENT = "vendia:notifications-changed";

export function notifyNotificationsChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

/**
 * Borra notificaciones (una, varias o todas con `ids = null`). Solo se ocultan para quien las
 * borra: el resto del equipo las sigue viendo. Devuelve false si no se pudo.
 */
export async function dismissNotifications(storeId: string, ids: string[] | null) {
  const { error } = await createClient().rpc("dismiss_notifications", { p_store_id: storeId, p_ids: ids });
  if (error) {
    toast.error(
      /dismiss_notifications/.test(error.message)
        ? "Falta correr la actualización de la base de datos (Bloque 13) para poder borrar notificaciones."
        : "No se pudo borrar. Intenta de nuevo.",
    );
    return false;
  }
  notifyNotificationsChanged();
  return true;
}

function browserNotify(title: string, body: string | null, link: string | null) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body: body ?? undefined, icon: "/icons/app-192.png", tag: title });
    n.onclick = () => {
      window.focus();
      if (link) window.location.href = link;
      n.close();
    };
  } catch {}
}

/**
 * Notificaciones en tiempo real de la tienda:
 * - Nuevos registros en `notifications` (pedido nuevo, riesgo, secuencia completa…) vía Supabase Realtime.
 * - Cambios en `orders` → evento para refrescar listas abiertas.
 * - Recordatorios de «llamar después» que vencen (revisa cada minuto).
 * Funciona con cualquier pestaña de Vendia abierta.
 */
export function NotificationBell({ storeId, initialUnread }: { storeId: string; initialUnread: number }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadItems = useCallback(async () => {
    const supabase = createClient();
    const [{ data: list }, { data: reads }] = await Promise.all([
      supabase.from("notifications").select("id, type, title, body, link, created_at").eq("store_id", storeId).order("created_at", { ascending: false }).limit(15),
      supabase.from("notification_reads").select("notification_id").limit(500),
    ]);
    const readSet = new Set((reads ?? []).map((r) => r.notification_id));
    setItems((list ?? []).map((n) => ({ ...n, read: readSet.has(n.id) })));
  }, [storeId]);

  // Tiempo real
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const channel = supabase.channel(`store-${storeId}`);

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `store_id=eq.${storeId}` }, (payload) => {
          const n = payload.new as Notification;
          setUnread((u) => u + 1);
          setItems((list) => (list ? [{ ...n, read: false }, ...list].slice(0, 15) : list));
          playNotificationSound(n.type === "new_order" ? "new_order" : "other");
          toast(n.title, {
            description: n.body ?? undefined,
            icon: <ShoppingBag className="size-4" />,
            action: n.link ? { label: "Ver", onClick: () => router.push(n.link!) } : undefined,
            duration: 8000,
          });
          if (document.visibilityState !== "visible") browserNotify(n.title, n.body, n.link);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` }, () => {
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => window.dispatchEvent(new Event(ORDERS_CHANGED_EVENT)), 800);
        })
        .subscribe();
    });

    return () => {
      active = false;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [storeId, router]);

  // Marcadas o borradas en otra parte (página Notificaciones): número y lista al día
  useEffect(() => {
    const onChange = async () => {
      const { data } = await createClient().rpc("unread_notifications_count", { p_store_id: storeId });
      if (typeof data === "number") setUnread(data);
      if (items) void loadItems();
    };
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);
  }, [storeId, items, loadItems]);

  // Recordatorios de «llamar después»
  useEffect(() => {
    const supabase = createClient();
    const notified = new Set<string>();
    try {
      for (const id of JSON.parse(sessionStorage.getItem("vd_callbacks") ?? "[]")) notified.add(id);
    } catch {}
    const check = async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, order_number, customer_name, next_contact_at")
        .eq("store_id", storeId)
        .in("status", ["new", "pending_confirmation"])
        .lte("next_contact_at", new Date().toISOString())
        .limit(20);
      for (const o of data ?? []) {
        const key = `${o.id}:${o.next_contact_at}`;
        if (notified.has(key)) continue;
        notified.add(key);
        const title = `Toca llamar · #${o.order_number}`;
        const body = `${o.customer_name} pidió que lo llamen a las ${formatDateTime(o.next_contact_at)}.`;
        playNotificationSound("other");
        toast(title, { description: body, action: { label: "Ver", onClick: () => router.push(`/dashboard/pedidos/${o.id}`) }, duration: 12000 });
        if (document.visibilityState !== "visible") browserNotify(title, body, `/dashboard/pedidos/${o.id}`);
      }
      try {
        sessionStorage.setItem("vd_callbacks", JSON.stringify([...notified].slice(-200)));
      } catch {}
    };
    void check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [storeId, router]);

  const markAllRead = async () => {
    const supabase = createClient();
    await supabase.rpc("mark_notifications_read", { p_store_id: storeId, p_ids: null });
    setUnread(0);
    setItems((list) => list?.map((n) => ({ ...n, read: true })) ?? list);
  };

  const dismissOne = async (n: Notification) => {
    if (!(await dismissNotifications(storeId, [n.id]))) return;
    setItems((list) => list?.filter((x) => x.id !== n.id) ?? list);
    if (!n.read) setUnread((u) => Math.max(0, u - 1));
  };

  const dismissAll = async () => {
    if (!(await dismissNotifications(storeId, null))) return;
    setItems([]);
    setUnread(0);
    router.refresh();
  };

  // Sonido de esta persona: se silencia rápido desde la campanita (los ajustes están en Notificaciones)
  const [sound, setSound] = useSoundPrefs();

  const enableBrowser = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      playSound(sound.sound, sound.volume);
      browserNotify("Avisos activados", "Te avisaremos de cada pedido nuevo mientras Vendia esté abierta.", null);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void loadItems();
      }}
    >
      <PopoverTrigger className="relative rounded-md p-2 hover:bg-muted" aria-label={`Notificaciones${unread ? ` (${unread} sin leer)` : ""}`}>
        {unread ? <BellRing className="size-5" /> : <Bell className="size-5" />}
        {unread ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            Notificaciones
            <button
              type="button"
              onClick={() => setSound({ ...sound, enabled: !sound.enabled })}
              aria-label={sound.enabled ? "Silenciar el sonido de los avisos" : "Activar el sonido de los avisos"}
              title={sound.enabled ? "Sonido activado (toca para silenciar)" : "Sonido silenciado (toca para activar)"}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {sound.enabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </button>
          </p>
          <span className="flex items-center gap-3">
            {unread ? (
              <button type="button" onClick={markAllRead} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Check className="size-3.5" /> Marcar leídas
              </button>
            ) : null}
            {items?.length ? (
              <button type="button" onClick={dismissAll} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive">
                <Trash2 className="size-3.5" /> Borrar todas
              </button>
            ) : null}
          </span>
        </div>
        {permission === "default" ? (
          <button type="button" onClick={enableBrowser} className="w-full border-b bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            🔔 <b>Activa los avisos del navegador</b> para enterarte de cada pedido aunque estés en otra pestaña.
          </button>
        ) : null}
        <div className="max-h-96 overflow-y-auto">
          {items === null ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Sin notificaciones.</p>
          ) : (
            items.map((n) => (
              <div key={n.id} className="group relative border-b">
                <Link
                  href={n.link ?? "/dashboard/notificaciones"}
                  onClick={() => setOpen(false)}
                  className={cn("flex flex-col gap-0.5 py-2 pr-9 pl-3 text-sm hover:bg-muted/50", !n.read && "bg-sky-50/60 dark:bg-sky-950/30")}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    {!n.read ? <span className="size-1.5 shrink-0 rounded-full bg-sky-500" /> : null}
                    {n.title}
                  </span>
                  {n.body ? <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span> : null}
                  <span className="text-[11px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => void dismissOne(n)}
                  aria-label="Borrar notificación"
                  title="Borrar"
                  className="absolute top-1.5 right-1.5 rounded-md p-1 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
        <Link href="/dashboard/notificaciones" onClick={() => setOpen(false)} className="block px-3 py-2 text-center text-xs font-medium hover:bg-muted">
          Ver todas
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Refresca la página cuando cambian los pedidos de la tienda (tiempo real). Como mucho una vez
 * cada 10 segundos, y solo con la pantalla a la vista (si está en segundo plano, al volver).
 */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let last = 0;
    let waiting = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (document.visibilityState !== "visible") {
        waiting = true;
        return;
      }
      if (timer) return;
      timer = setTimeout(
        () => {
          timer = null;
          waiting = false;
          last = Date.now();
          router.refresh();
        },
        Math.max(0, last + 10_000 - Date.now()),
      );
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && waiting) onChange();
    };
    window.addEventListener(ORDERS_CHANGED_EVENT, onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(ORDERS_CHANGED_EVENT, onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
  return null;
}
