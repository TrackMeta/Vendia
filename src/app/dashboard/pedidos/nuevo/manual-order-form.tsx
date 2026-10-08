"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { UbigeoPicker, type UbigeoValue } from "@/modules/landing/render/ubigeo-picker";
import { zoneOf } from "@/modules/orders/contact";
import { splitFullName } from "@/modules/orders/order-input";
import { createManualOrder, type ManualOrderInput } from "../actions";

type Product = { id: string; name: string; price: number; variantLabel: string | null; variants: { id: string; name: string; stock: number | null }[] };
type Offer = { id: string; productId: string; name: string; quantity: number; price: number };

const CHANNELS = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook / Messenger", tiktok: "TikTok", llamada: "Llamada", tienda: "Tienda física", otro: "Otro" } as const;
const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ManualOrderForm({
  products,
  offers,
  shipping,
  defaultAdvance,
}: {
  products: Product[];
  offers: Offer[];
  shipping: { lima: number; province: number };
  defaultAdvance: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [productId, setProductId] = useState(products[0].id);
  const productOffers = offers.filter((o) => o.productId === productId);
  const [offerId, setOfferId] = useState<string>(productOffers[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState<string>("");
  const [channel, setChannel] = useState<keyof typeof CHANNELS>("whatsapp");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [dni, setDni] = useState("");
  const [ubigeo, setUbigeo] = useState<UbigeoValue>({ department: "", province: "", district: "" });
  const [address, setAddress] = useState("");
  const [reference, setReference] = useState("");
  const [shippingOverride, setShippingOverride] = useState<string>("");
  const [advance, setAdvance] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [confirmed, setConfirmed] = useState(true);
  const [variantPicks, setVariantPicks] = useState<string[]>([]);

  const product = products.find((p) => p.id === productId)!;
  const offer = productOffers.find((o) => o.id === offerId);
  const basePrice = offer ? offer.price : product.price * quantity;
  const units = offer ? offer.quantity : quantity;
  const picks = Array.from({ length: product.variants.length ? units : 0 }, (_, i) => variantPicks[i] ?? "");
  const subtotal = price === "" ? basePrice : Number(price) || 0;
  const zone = ubigeo.province ? zoneOf(ubigeo.province) : null;
  const zoneShipping = zone === "lima" ? shipping.lima : zone === "provincia" ? shipping.province : 0;
  const shippingValue = shippingOverride === "" ? zoneShipping : Number(shippingOverride) || 0;
  const total = subtotal + shippingValue;
  const advanceValue = advance === "" ? (zone === "provincia" ? Math.min(defaultAdvance, total) : 0) : Number(advance) || 0;

  const summary = [
      ["Subtotal", formatMoney(subtotal)],
      ["Envío", zone ? formatMoney(shippingValue) : "Elige el distrito"],
      ["Total", formatMoney(total)],
      ["Adelanto", formatMoney(advanceValue)],
      ["Saldo a cobrar", formatMoney(total - advanceValue)],
  ];

  const submit = () => {
    const names = splitFullName(fullName);
    const input: ManualOrderInput = {
      idempotency_key: idempotencyKey,
      product_id: productId,
      offer_id: offer ? offer.id : "",
      quantity: offer ? undefined : quantity,
      subtotal: price === "" ? "" : Number(price),
      shipping: shippingOverride === "" ? "" : Number(shippingOverride),
      advance: advanceValue,
      first_name: names.first_name,
      last_name: names.last_name,
      phone,
      dni: dni || undefined,
      district_code: ubigeo.district,
      address,
      reference: reference || undefined,
      source_channel: channel,
      notes: notes || undefined,
      internal_notes: internalNotes || undefined,
      already_confirmed: confirmed,
      variants: product.variants.length ? picks : undefined,
    };
    if (product.variants.length && picks.some((p) => !p)) {
      toast.error(`Elige ${(product.variantLabel ?? "la variante").toLowerCase()} de cada unidad`);
      return;
    }
    startTransition(async () => {
      const r = await createManualOrder(input);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Pedido #${r.orderNumber} registrado`);
      router.push(`/dashboard/pedidos/${r.orderId}`);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Producto</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Producto">
            <select
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setOfferId(offers.find((o) => o.productId === e.target.value)?.id ?? "");
                setPrice("");
                setVariantPicks([]);
              }}
              className={selectClass}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Oferta">
            <select
              value={offerId}
              onChange={(e) => {
                setOfferId(e.target.value);
                setPrice("");
              }}
              className={selectClass}
            >
              {productOffers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {formatMoney(o.price)}
                </option>
              ))}
              <option value="">Cantidad libre</option>
            </select>
          </Field>
          {!offer ? (
            <Field label="Cantidad">
              <Input type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          ) : null}
          {picks.length ? (
            <div className="flex flex-col gap-2 sm:col-span-2">
              {picks.map((pick, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-28 text-sm text-muted-foreground">
                    {product.variantLabel ?? "Variante"} {units > 1 ? i + 1 : ""}
                  </span>
                  {product.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() =>
                        setVariantPicks(() => {
                          const next = [...picks];
                          next[i] = v.id;
                          return next;
                        })
                      }
                      className={`rounded-md border px-2.5 py-1 text-sm ${pick === v.id ? "border-foreground bg-foreground text-background" : "hover:bg-muted"}`}
                    >
                      {v.name}
                      {v.stock !== null ? <span className="ml-1 text-xs opacity-60">({v.stock})</span> : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          <Field label="Precio acordado (S/)" hint={`Por defecto ${formatMoney(basePrice)}. Cámbialo si negociaste otro precio.`}>
            <Input type="number" step="0.01" min={0} value={price} placeholder={basePrice.toFixed(2)} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="¿Por dónde llegó?">
            <select value={channel} onChange={(e) => setChannel(e.target.value as keyof typeof CHANNELS)} className={selectClass}>
              {Object.entries(CHANNELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cliente y entrega</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre completo">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre y apellido" />
          </Field>
          <Field label="Celular">
            <Input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} placeholder="987 654 321" />
          </Field>
          <Field label="DNI" hint={zone === "provincia" ? "Necesario para que recoja en la agencia Shalom." : undefined}>
            <Input value={dni} inputMode="numeric" maxLength={8} onChange={(e) => setDni(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Ubicación">
              <UbigeoPicker value={ubigeo} onChange={setUbigeo} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Dirección">
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Av. Los Héroes 123, Dpto 402" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Referencia">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Montos</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label={`Envío (S/)${zone ? ` · ${zone === "lima" ? "Lima" : "Provincia"}` : ""}`} hint={`Por defecto ${formatMoney(zoneShipping)} según la zona.`}>
            <Input type="number" step="0.01" min={0} value={shippingOverride} placeholder={zoneShipping.toFixed(2)} onChange={(e) => setShippingOverride(e.target.value)} />
          </Field>
          <Field label="Adelanto (S/)" hint="En provincia, lo que pagó antes del envío.">
            <Input type="number" step="0.01" min={0} value={advance} placeholder={advanceValue.toFixed(2)} onChange={(e) => setAdvance(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3 text-sm sm:col-span-2">
            {summary.map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </div>
          <div className="sm:col-span-2">
            <Field label="Nota del cliente (opcional)">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Nota interna (opcional)">
              <Textarea rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="size-4" />
            Ya está confirmado con el cliente (pasa directo a «Por despachar»)
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" disabled={pending} onClick={submit}>
          {pending ? "Registrando…" : "Registrar pedido"}
        </Button>
      </div>
    </div>
  );
}
