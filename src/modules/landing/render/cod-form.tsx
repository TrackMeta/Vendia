"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { publicAssetUrl } from "@/lib/env";
import { formatMoney } from "@/lib/format";
import { readAttribution } from "@/modules/attribution/capture";
import { trackPixel } from "@/modules/meta/pixel";
import { zoneOf } from "@/modules/orders/contact";
import { splitFullName } from "@/modules/orders/order-input";
import type { FormBlock } from "../schema";
import { type LandingRenderData, shippingFor } from "../types";
import { UbigeoPicker, type UbigeoValue } from "./ubigeo-picker";

const TEXT_ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;

const inputClass =
  "h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-zinc-800">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CodForm({ data, preview }: { data: LandingRenderData; preview: boolean }) {
  const router = useRouter();
  const { content, offers } = data;
  const fieldsBlock = content.form_blocks.find((b) => b.type === "form_fields") as
    | Extract<FormBlock, { type: "form_fields" }>
    | undefined;

  const [offerId, setOfferId] = useState(() => (offers.find((o) => o.is_default) ?? offers[0])?.id ?? "");
  const [fullName, setFullName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [dni, setDni] = useState("");
  const [ubigeo, setUbigeo] = useState<UbigeoValue>({ department: "", province: "", district: "" });
  const [address, setAddress] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const offer = offers.find((o) => o.id === offerId);
  const shipping = shippingFor(ubigeo.province || null, data.shipping);
  const subtotal = offer?.price ?? 0;
  const total = subtotal + (shipping ?? 0);
  // Provincia: adelanto y DNI (para recoger en la agencia). Lima: contraentrega pura.
  const provincia = ubigeo.province ? zoneOf(ubigeo.province) === "provincia" : false;
  const advance = provincia ? Math.min(data.advanceAmount, total) : 0;
  const showDni = Boolean(fieldsBlock?.askDni) || provincia;

  const validationError = (() => {
    if (!offer) return "Selecciona una oferta";
    const name = fieldsBlock?.singleNameField ? fullName : firstName;
    if (name.trim().length < 2) return "Ingresa tu nombre";
    if (phone.replace(/\D/g, "").length < 9) return "Ingresa tu celular de 9 dígitos";
    if (!ubigeo.district) return "Selecciona tu departamento, provincia y distrito";
    if (address.trim().length < 5) return "Ingresa tu dirección completa";
    if (fieldsBlock?.requireReference && reference.trim().length < 3) return "Ingresa una referencia de tu dirección";
    if (provincia && !/^\d{8}$/.test(dni)) return "Ingresa tu DNI (8 dígitos): lo pide la agencia para entregarte";
    if (dni && !/^\d{8}$/.test(dni)) return "El DNI debe tener 8 dígitos";
    return null;
  })();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (preview || !data.landingId) {
      setError("Vista previa: el pedido no se envía. Publica la landing para recibir pedidos.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const names = fieldsBlock?.singleNameField ? splitFullName(fullName) : { first_name: firstName, last_name: lastName };
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          landing_page_id: data.landingId,
          offer_id: offerId,
          idempotency_key: idempotencyKey,
          ...names,
          phone,
          whatsapp: whatsapp || undefined,
          dni: dni || undefined,
          district_code: ubigeo.district,
          address,
          reference: reference || undefined,
          notes: notes || undefined,
          website: honeypot,
          attribution: readAttribution(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "No pudimos registrar tu pedido. Inténtalo de nuevo.");
        setSubmitting(false);
        return;
      }
      // Lead con el MISMO eventID que el servidor envía por Conversions API → Meta deduplica
      trackPixel("Lead", { value: json.total, currency: "PEN", content_ids: data.productId ? [data.productId] : [] }, json.leadEventId);
      router.push(`/p/${data.storeSlug}/${data.landingSlug}/gracias?pedido=${json.orderNumber}`);
    } catch {
      setError("Revisa tu conexión a internet e inténtalo de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {/* Campo trampa anti-bots (oculto para personas) */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        aria-hidden="true"
      />

      {content.form_blocks.map((block) => {
        switch (block.type) {
          case "form_image": {
            const src = publicAssetUrl(block.src);
            return src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={block.id} src={src} alt={block.alt} className="block h-auto w-full rounded-lg" />
            ) : null;
          }
          case "form_text":
            return (
              <p key={block.id} className={`whitespace-pre-line text-lg font-bold text-zinc-900 ${TEXT_ALIGN[block.align]}`}>
                {block.text}
              </p>
            );
          case "form_offers":
            return (
              <div key={block.id} className="flex flex-col gap-2">
                {block.title ? <p className="text-base font-bold text-zinc-900">{block.title}</p> : null}
                {offers.length === 0 ? <p className="text-sm text-red-600">Este producto no tiene ofertas activas.</p> : null}
                {offers.map((o) => {
                  const selected = o.id === offerId;
                  const img = publicAssetUrl(o.image_path);
                  return (
                    <button
                      type="button"
                      key={o.id}
                      onClick={() => setOfferId(o.id)}
                      className={`relative flex items-center gap-3 rounded-xl border-2 p-2.5 text-left transition-colors ${
                        selected ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white"
                      }`}
                    >
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={o.name} className="size-14 shrink-0 rounded-lg object-cover" />
                      ) : null}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="font-bold text-zinc-900">{o.name}</span>
                        {o.badge ? (
                          <span className="w-fit rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">{o.badge}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end">
                        {o.compare_at_price && o.compare_at_price > o.price ? (
                          <span className="text-xs text-zinc-400 line-through">{formatMoney(o.compare_at_price)}</span>
                        ) : null}
                        <span className="text-lg font-extrabold text-zinc-900">{formatMoney(o.price)}</span>
                      </div>
                      {selected ? <CheckCircle2 className="absolute -top-2 -right-2 size-5 rounded-full bg-white text-zinc-900" /> : null}
                    </button>
                  );
                })}
              </div>
            );
          case "form_fields":
            return (
              <div key={block.id} className="flex flex-col gap-3">
                {block.singleNameField ? (
                  <Field label="Nombre completo" required>
                    <input className={inputClass} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre y apellido" />
                  </Field>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nombre" required>
                      <input className={inputClass} autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    </Field>
                    <Field label="Apellido">
                      <input className={inputClass} autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </Field>
                  </div>
                )}
                <Field label="Celular" required>
                  <input
                    className={inputClass}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, "").slice(0, 11))}
                    placeholder="987 654 321"
                  />
                </Field>
                {block.askWhatsapp ? (
                  <Field label="WhatsApp (si es otro número)">
                    <input className={inputClass} type="tel" inputMode="numeric" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
                  </Field>
                ) : null}
                {showDni ? (
                  <Field label={provincia ? "DNI (para recoger en la agencia)" : "DNI"} required={provincia}>
                    <input className={inputClass} inputMode="numeric" maxLength={8} value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, ""))} />
                  </Field>
                ) : null}
                <Field label="Ubicación" required>
                  <UbigeoPicker value={ubigeo} onChange={setUbigeo} />
                </Field>
                <Field label="Dirección completa" required>
                  <input className={inputClass} autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Av. Los Héroes 123, Dpto 402" />
                </Field>
                <Field label="Referencia" required={block.requireReference}>
                  <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Frente al parque, casa verde" />
                </Field>
                {block.askNotes ? (
                  <Field label="Observaciones">
                    <textarea className={`${inputClass} h-20 py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                ) : null}
              </div>
            );
          case "form_summary":
            return (
              <div key={block.id} className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-semibold text-zinc-900">{formatMoney(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Envío</span>
                  <span className="font-semibold text-zinc-900">
                    {shipping === null ? "Elige tu distrito" : shipping === 0 ? "Gratis" : formatMoney(shipping)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-zinc-200 pt-1.5 text-base">
                  <span className="font-bold text-zinc-900">Total</span>
                  <span className="text-lg font-extrabold text-zinc-900">{formatMoney(total)}</span>
                </div>
                {advance > 0 ? (
                  <>
                    <div className="flex justify-between">
                      <span>Adelanto</span>
                      <span className="font-semibold text-zinc-900">{formatMoney(advance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Pagas al recibir</span>
                      <span className="font-semibold text-zinc-900">{formatMoney(total - advance)}</span>
                    </div>
                  </>
                ) : null}
              </div>
            );
          case "form_submit":
            return (
              <div key={block.id} className="flex flex-col gap-2">
                {error ? (
                  <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm font-medium text-red-700">
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ backgroundColor: block.bg, color: block.color }}
                  className="flex w-full flex-col items-center justify-center gap-0.5 rounded-xl px-4 py-3.5 shadow-lg transition-transform active:scale-[0.98] disabled:opacity-70"
                >
                  <span className="flex items-center gap-2 text-lg font-extrabold">
                    {submitting ? <Loader2 className="size-5 animate-spin" /> : null}
                    {submitting ? "Enviando…" : block.text}
                  </span>
                  {block.subtext && !submitting ? <span className="text-xs font-medium opacity-90">{block.subtext}</span> : null}
                </button>
              </div>
            );
        }
      })}
    </form>
  );
}
