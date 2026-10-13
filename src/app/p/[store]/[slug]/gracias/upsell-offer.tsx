"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { publicAssetUrl } from "@/lib/env";
import { formatMoney } from "@/lib/format";
import type { ThankYouUpsell } from "@/modules/landing/schema";
import { softBackground } from "@/modules/landing/thank-you";

/** Oferta de un clic en la página de gracias: se suma al mismo pedido (sin volver a llenar datos). */
export function UpsellOffer({ upsell, orderId, landingId }: { upsell: ThankYouUpsell; orderId: string; landingId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "declined">("idle");
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const img = publicAssetUrl(upsell.image);
  const accent = /^#[0-9a-f]{6}$/i.test(upsell.color ?? "") ? upsell.color : "#ea580c";

  if (state === "declined") return null;
  if (state === "done") {
    return (
      <div className="flex w-full items-center gap-2 rounded-xl bg-green-50 p-3 text-left text-sm text-green-800">
        <CheckCircle2 className="size-5 shrink-0" />
        <span>
          ¡Listo! Agregamos <b>{upsell.name}</b> a tu pedido.{total !== null ? ` Nuevo total: ${formatMoney(total)}.` : ""}
        </span>
      </div>
    );
  }

  const add = async () => {
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/orders/upsell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId, landing_id: landingId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "No pudimos agregarlo.");
        setState("idle");
        return;
      }
      setTotal(json.total);
      setState("done");
    } catch {
      setError("Revisa tu conexión e inténtalo de nuevo.");
      setState("idle");
    }
  };

  return (
    <div
      className="flex w-full flex-col gap-3 rounded-2xl border-2 border-dashed p-4 text-left"
      style={{ borderColor: accent, background: softBackground(accent) }}
    >
      {upsell.headline ? (
        <p className="text-center text-xs font-bold tracking-wide uppercase" style={{ color: accent }}>
          {upsell.headline}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
        ) : null}
        <div className="flex min-w-0 flex-col">
          <span className="font-bold text-zinc-900">{upsell.name}</span>
          {/* El precio nunca se parte en dos líneas */}
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xl font-black whitespace-nowrap text-zinc-900">{formatMoney(upsell.price)}</span>
            {upsell.compareAt && upsell.compareAt > upsell.price ? (
              <span className="text-sm whitespace-nowrap text-zinc-400 line-through">{formatMoney(upsell.compareAt)}</span>
            ) : null}
          </span>
        </div>
      </div>
      {upsell.text ? <p className="text-sm whitespace-pre-line text-zinc-700">{upsell.text}</p> : null}
      {error ? <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        onClick={add}
        disabled={state === "sending"}
        className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-extrabold text-white shadow disabled:opacity-70"
        style={{ background: accent }}
      >
        {state === "sending" ? <Loader2 className="size-5 animate-spin" /> : null}
        {upsell.buttonText}
      </button>
      <button type="button" onClick={() => setState("declined")} className="text-xs text-zinc-500 underline underline-offset-4">
        No, gracias
      </button>
    </div>
  );
}
