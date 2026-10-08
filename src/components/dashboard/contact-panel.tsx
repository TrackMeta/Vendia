"use client";

import { CalendarClock, Check, MessageCircle, Phone, PhoneOff, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { logContactAttempt } from "@/app/dashboard/pedidos/actions";
import { Button } from "@/components/ui/button";
import { displayPeruPhone, formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CANCEL_REASONS, CONTACT_RESULTS, type ContactChannel, type ContactResult, sequenceLabels } from "@/modules/orders/contact";

export type ContactOrder = {
  id: string;
  order_number: number;
  customer_name: string;
  customer_phone: string;
  total: number;
  address: string;
  district_name: string;
  product_label: string;
  contact_attempts: number;
  last_contact_result: string | null;
  next_contact_at: string | null;
  contact_sequence_done: boolean;
};

export function whatsappConfirmLink(o: Pick<ContactOrder, "customer_name" | "customer_phone" | "order_number" | "product_label" | "total" | "address" | "district_name">, storeName: string) {
  const text = `Hola ${o.customer_name.split(" ")[0]}, te saludamos de ${storeName}. Recibimos tu pedido #${o.order_number} de ${o.product_label} por ${formatMoney(o.total)}, con entrega en ${o.address}, ${o.district_name}. ¿Nos confirmas tu pedido?`;
  return `https://wa.me/${o.customer_phone}?text=${encodeURIComponent(text)}`;
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Secuencia de contacto de un pedido por confirmar:
 * Llamada 1 → 2 → 3 → WhatsApp (configurable), seguidas, con resultado de cada intento.
 * Se puede cancelar desde el primer intento. Al terminar la secuencia solo se avisa.
 */
export function ContactPanel({ order, sequence, storeName, compact = false }: { order: ContactOrder; sequence: ContactChannel[]; storeName: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const labels = sequenceLabels(sequence);
  const stepIndex = order.contact_attempts < sequence.length ? order.contact_attempts : null;
  const [channel, setChannel] = useState<ContactChannel>(stepIndex !== null ? sequence[stepIndex] : "call");
  const [mode, setMode] = useState<null | "later" | "reject">(null);
  const [laterAt, setLaterAt] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60_000)));
  const [rejectReason, setRejectReason] = useState<keyof typeof CANCEL_REASONS>("ya_no_lo_quiere");
  const [note, setNote] = useState("");

  const submit = (result: ContactResult, extra: { nextContactAt?: string; cancelReason?: string } = {}) =>
    startTransition(async () => {
      const r = await logContactAttempt({ orderId: order.id, channel, result, note: note.trim() || undefined, ...extra });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.sequenceDone && result !== "confirmed" && result !== "rejected") toast.warning(r.message, { description: "Revisa si cancelas el pedido." });
      else toast.success(r.message);
      setMode(null);
      setNote("");
      if (r.nextChannel === "call" || r.nextChannel === "whatsapp") setChannel(r.nextChannel);
      router.refresh();
    });

  const telHref = `tel:+${order.customer_phone}`;
  const waHref = whatsappConfirmLink(order, storeName);

  return (
    <div className={cn("flex flex-col gap-3", !compact && "rounded-xl border p-3")}>
      {/* Avance de la secuencia */}
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.map((label, i) => {
          const done = i < order.contact_attempts;
          const current = i === stepIndex;
          return (
            <span
              key={label}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs",
                done && "border-transparent bg-muted text-muted-foreground line-through decoration-muted-foreground/40",
                current && "border-primary bg-primary/10 font-semibold text-primary",
              )}
            >
              {sequence[i] === "call" ? "📞" : "💬"} {label}
            </span>
          );
        })}
        {order.contact_attempts > sequence.length ? (
          <span className="text-xs text-muted-foreground">+{order.contact_attempts - sequence.length} extra</span>
        ) : null}
        {order.last_contact_result ? (
          <span className="text-xs text-muted-foreground">
            · Último: {CONTACT_RESULTS[order.last_contact_result as ContactResult]?.label ?? order.last_contact_result}
          </span>
        ) : null}
      </div>

      {order.next_contact_at ? (
        <p className="flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-100">
          <CalendarClock className="size-3.5" /> Llamar a las {formatDateTime(order.next_contact_at)}
        </p>
      ) : null}
      {order.contact_sequence_done ? (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Secuencia completa sin respuesta. Puedes seguir intentando o cancelarlo con el motivo «No contesta».
        </p>
      ) : null}

      {/* Contactar */}
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={telHref}
          onClick={() => setChannel("call")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted",
            channel === "call" && "border-primary text-primary",
          )}
        >
          <Phone className="size-4" /> Llamar {displayPeruPhone(order.customer_phone)}
        </a>
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setChannel("whatsapp")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white",
            "bg-[#25D366]",
            channel === "whatsapp" && "ring-2 ring-[#25D366]/40 ring-offset-1",
          )}
        >
          <MessageCircle className="size-4" /> WhatsApp
        </a>
        <span className="text-xs text-muted-foreground">Registrando como: {channel === "call" ? "llamada" : "WhatsApp"}</span>
      </div>

      {/* Resultado */}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" disabled={pending} onClick={() => submit("confirmed")} className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Check /> Confirmó
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => submit("no_answer")}>
          No contesta
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => submit("phone_off")}>
          <PhoneOff /> Apagado
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setMode(mode === "later" ? null : "later")}>
          <CalendarClock /> Llamar después
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => submit("wrong_number")}>
          Número equivocado
        </Button>
        <Button size="sm" variant="destructive" disabled={pending} onClick={() => setMode(mode === "reject" ? null : "reject")}>
          <X /> Rechazó / cancelar
        </Button>
      </div>

      {mode === "later" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2">
          <label className="text-sm">¿Cuándo volver a llamar?</label>
          <input type="datetime-local" value={laterAt} onChange={(e) => setLaterAt(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm" />
          <Button size="sm" disabled={pending || !laterAt} onClick={() => submit("call_later", { nextContactAt: new Date(laterAt).toISOString() })}>
            Guardar
          </Button>
        </div>
      ) : null}
      {mode === "reject" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive/5 p-2">
          <label className="text-sm">Motivo:</label>
          <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value as keyof typeof CANCEL_REASONS)} className="h-8 rounded-md border bg-background px-2 text-sm">
            {Object.entries(CANCEL_REASONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="destructive" disabled={pending} onClick={() => submit("rejected", { cancelReason: rejectReason })}>
            Cancelar pedido
          </Button>
        </div>
      ) : null}

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="Nota del intento (opcional): «dijo que confirma en la tarde»…"
        className="h-8 rounded-md border bg-background px-2 text-sm"
      />
    </div>
  );
}
