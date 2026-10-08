"use client";

import Link from "next/link";
import { ImageField, NumberField, TextField, ToggleField } from "@/components/dashboard/fields";
import type { LandingContent } from "@/modules/landing/schema";
import type { LandingSettings } from "../actions";
import { ProductLink } from "./block-inspector";

type OtherLanding = { id: string; title: string; slug: string; status: string };
type Ctx = { storeId: string; folder: string; products?: { id: string; name: string; price: number }[] };

function Section({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

const moneyInput = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** Pestaña «Ventas» del editor: WhatsApp, upsell de la página de gracias, ángulo creativo y prueba A/B. */
export function SalesPanel({
  content,
  update,
  settings,
  onSettings,
  landingId,
  otherLandings,
  storeWhatsapp,
  ctx,
}: {
  content: LandingContent;
  update: (updater: (c: LandingContent) => LandingContent) => void;
  settings: LandingSettings;
  onSettings: (s: LandingSettings) => void;
  landingId: string;
  otherLandings: OtherLanding[];
  storeWhatsapp: string | null;
  ctx: Ctx;
}) {
  const wa = content.whatsapp_button;
  const up = content.thank_you_upsell;
  const setWa = (patch: Partial<typeof wa>) => update((c) => ({ ...c, whatsapp_button: { ...c.whatsapp_button, ...patch } }));
  const setUp = (patch: Partial<typeof up>) => update((c) => ({ ...c, thank_you_upsell: { ...c.thank_you_upsell, ...patch } }));
  const ab = settings.ab;
  const weightOf = (id: string) => ab.variants.find((v) => v.landing_id === id)?.weight;
  const toggleVariant = (id: string, on: boolean) => {
    const variants = on ? [...ab.variants, { landing_id: id, weight: 50 }] : ab.variants.filter((v) => v.landing_id !== id);
    onSettings({ ...settings, ab: { ...ab, variants } });
  };
  const setWeight = (id: string, weight: number) =>
    onSettings({ ...settings, ab: { ...ab, variants: ab.variants.map((v) => (v.landing_id === id ? { ...v, weight } : v)) } });
  const totalWeight = ab.variants.reduce((s, v) => s + v.weight, 0);
  const candidates = [{ id: landingId, title: "Esta landing", slug: "", status: "published" }, ...otherLandings];

  return (
    <div className="flex flex-col gap-4">
      <Section title="Botón flotante de WhatsApp" hint="Abajo a la derecha. Abre un chat con tu número de Configuración.">
        <ToggleField label="Mostrar el botón" checked={wa.enabled} onChange={(enabled) => setWa({ enabled })} />
        {wa.enabled ? (
          <>
            {!storeWhatsapp ? (
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Falta tu número de WhatsApp.{" "}
                <Link href="/dashboard/configuracion" className="underline">
                  Agrégalo en Configuración
                </Link>
                .
              </p>
            ) : null}
            <NumberField label="Tamaño" value={wa.size} min={40} max={80} suffix="px" onChange={(size) => setWa({ size })} />
            <TextField label="Mensaje que se escribe solo" value={wa.message} onChange={(message) => setWa({ message })} />
          </>
        ) : null}
      </Section>

      <Section title="Oferta en la página de gracias" hint="Después de pedir, el cliente puede sumar este producto a su MISMO pedido con un clic (hasta 30 min y antes de confirmar).">
        <ToggleField label="Mostrar la oferta" checked={up.enabled} onChange={(enabled) => setUp({ enabled })} />
        {up.enabled ? (
          <>
            <TextField label="Nombre" value={up.name} onChange={(name) => setUp({ name })} placeholder="Segunda unidad a mitad de precio" />
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-xs font-medium">
                Precio (S/)
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={up.price}
                  onChange={(e) => setUp({ price: Math.max(0, Number(e.target.value) || 0) })}
                  className={moneyInput}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium">
                Precio antes (tachado)
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={up.compareAt ?? ""}
                  onChange={(e) => setUp({ compareAt: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })}
                  className={moneyInput}
                />
              </label>
            </div>
            <TextField label="Texto" value={up.text} onChange={(text) => setUp({ text })} multiline />
            <TextField label="Texto del botón" value={up.buttonText} onChange={(buttonText) => setUp({ buttonText })} />
            <ProductLink value={up.productId} products={ctx.products ?? []} onChange={(productId) => setUp({ productId })} />
            {!up.productId ? (
              <label className="flex flex-col gap-1.5 text-xs font-medium">
                Tu costo (para la utilidad)
                <input type="number" step="0.1" min={0} value={up.cost} onChange={(e) => setUp({ cost: Math.max(0, Number(e.target.value) || 0) })} className={moneyInput} />
              </label>
            ) : null}
            <ImageField label="Imagen" value={up.image} onChange={(image) => setUp({ image })} storeId={ctx.storeId} folder={ctx.folder} maxSize={600} />
          </>
        ) : null}
      </Section>

      <Section title="Ángulo creativo" hint="Ej: «dolor de espalda», «postparto», «regalo». En Rendimiento → Ángulos ves cuál vende más con su CPA real.">
        <TextField label="Ángulo de esta landing" value={settings.angle} onChange={(angle) => onSettings({ ...settings, angle: angle.slice(0, 60) })} placeholder="Dolor de espalda" />
      </Section>

      <Section
        title="Prueba A/B"
        hint="Usa el link de ESTA landing en tu anuncio: Vendia reparte las visitas entre las landings elegidas (cada visitante ve siempre la misma) y conserva los UTM."
      >
        <ToggleField label="Activar la prueba" checked={ab.enabled} onChange={(enabled) => onSettings({ ...settings, ab: { ...ab, enabled } })} />
        {ab.enabled ? (
          <div className="flex flex-col gap-2">
            {candidates.map((l) => {
              const weight = weightOf(l.id);
              const on = weight !== undefined;
              return (
                <div key={l.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={on} onChange={(e) => toggleVariant(l.id, e.target.checked)} className="size-4" aria-label={`Incluir ${l.title}`} />
                  <span className="min-w-0 flex-1 truncate">
                    {l.title}
                    {l.status !== "published" ? <span className="text-xs text-amber-600"> · borrador (publícala)</span> : null}
                  </span>
                  {on ? (
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={weight}
                        onChange={(e) => setWeight(l.id, Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))}
                        className="h-7 w-16 rounded-md border bg-transparent px-2 text-right text-sm"
                        aria-label={`Peso de ${l.title}`}
                      />
                      <span className="w-10 text-right text-xs text-muted-foreground">{totalWeight ? `${Math.round(((weight ?? 0) / totalWeight) * 100)}%` : "—"}</span>
                    </span>
                  ) : null}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">Elige 2 o más landings del mismo producto. Los números son el peso de cada una.</p>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
