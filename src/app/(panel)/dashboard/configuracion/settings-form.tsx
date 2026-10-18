"use client";

import { type FormEvent, startTransition, useActionState, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ClipboardCheck, Megaphone, Package, Store, Truck, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ImageField } from "@/components/dashboard/fields";
import { REAL_SALE_MODES } from "@/modules/metrics/real-sale";
import { saveSettings } from "./actions";
import { AppSelect } from "@/components/dashboard/app-select";
import { FIELD_TAB, SETTINGS_TABS, type SettingsTabId, DEFAULT_SETTINGS_TAB, tabLabel } from "./settings-tabs";

type Values = {
  name: string;
  whatsapp: string;
  phone: string;
  email: string;
  address: string;
  logo_path: string;
  favicon_path: string;
  shipping_lima: number;
  shipping_province: number;
  advance_amount: number;
  packaging_cost: number;
  payment_methods: string;
  real_sale_mode: string;
  ad_currency: string;
  usd_rate: number;
  apply_igv: boolean;
  contact_calls: number;
  contact_whatsapp: boolean;
};

const TAB_ICONS: Record<SettingsTabId, LucideIcon> = {
  tienda: Store,
  envios: Truck,
  couriers: Package,
  publicidad: Megaphone,
  pedidos: ClipboardCheck,
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SettingsForm({
  storeId,
  storeSlug,
  initial,
  initialTab,
  couriers,
}: {
  storeId: string;
  storeSlug: string;
  initial: Values;
  initialTab: SettingsTabId;
  couriers: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(saveSettings, undefined);
  const [logo, setLogo] = useState(initial.logo_path);
  const [favicon, setFavicon] = useState(initial.favicon_path);
  const [example, setExample] = useState({ lima: initial.shipping_lima, province: initial.shipping_province, advance: initial.advance_amount });
  const [tab, setTab] = useState<SettingsTabId>(initialTab);
  const [errorTab, setErrorTab] = useState<SettingsTabId | null>(null);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Si se llega con otro ?tab= (un enlace dentro de la app), se abre esa pestaña
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);
  if (initialTab !== prevInitialTab) {
    setPrevInitialTab(initialTab);
    setTab(initialTab);
  }

  // Respuesta del servidor: si falla un campo, se abre su pestaña
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) {
      setDirty(false);
      setErrorTab(null);
    } else if (state) {
      const target = state.field ? FIELD_TAB[state.field] : undefined;
      setErrorTab(target ?? null);
      if (target) setTab(target);
    }
  }

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? "Guardado");
      return;
    }
    const target = state.field ? FIELD_TAB[state.field] : undefined;
    toast.error(state.error, target ? { description: `Revisa la pestaña «${tabLabel(target)}».` } : undefined);
    if (!state.field) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${state.field}"]:not([type="hidden"])`);
    requestAnimationFrame(() => el?.focus());
  }, [state]);

  // La pestaña va en la URL (?tab=envios) para que un enlace o recargar la mantenga
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === DEFAULT_SETTINGS_TAB) url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  // Un campo obligatorio vacío en otra pestaña: el navegador no puede mostrar el aviso, así que se abre esa pestaña
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    let handled = false;
    const onInvalid = (e: Event) => {
      if (handled) return;
      handled = true;
      setTimeout(() => (handled = false), 0);
      const el = e.target as HTMLInputElement;
      const panel = el.closest<HTMLElement>("[data-settings-tab]");
      const target = panel?.dataset.settingsTab as SettingsTabId | undefined;
      // En la pestaña visible el navegador ya muestra su aviso
      if (!panel || !target || !panel.hidden) return;
      flushSync(() => {
        setTab(target);
        setErrorTab(target);
      });
      requestAnimationFrame(() => {
        el.focus();
        el.reportValidity();
      });
    };
    form.addEventListener("invalid", onInvalid, true);
    return () => form.removeEventListener("invalid", onInvalid, true);
  }, []);

  // Se envía a mano: con <form action> React vacía el formulario tras cada envío (un WhatsApp inválido borraba todo lo editado)
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorTab(null);
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => action(data));
  };

  const markDirty = () => setDirty(true);
  const productPrice = 79;
  const total = productPrice + example.lima;
  const provinceTotal = productPrice + example.province;
  const current = SETTINGS_TABS.find((t) => t.id === tab) ?? SETTINGS_TABS[0];

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTabId)} className="gap-4">
      <div ref={listRef} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
        <TabsList aria-label="Secciones de configuración" className="h-10! w-max">
          {SETTINGS_TABS.map((t) => {
            const Icon = TAB_ICONS[t.id];
            return (
              <TabsTrigger key={t.id} value={t.id} className="flex-none px-3">
                <Icon />
                {t.label}
                {errorTab === t.id ? (
                  <span className="size-2 rounded-full bg-destructive" aria-label="Tiene un error" role="img" />
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      <p className="text-sm text-muted-foreground">{current.description}</p>

      {/* Un solo formulario: todas las pestañas quedan montadas (solo se ocultan) y se guardan juntas */}
      <form ref={formRef} onSubmit={submit} onInput={markDirty} className={cn("flex flex-col gap-6", tab === "couriers" && "hidden")}>
        <input type="hidden" name="logo_path" value={logo} />
        <input type="hidden" name="favicon_path" value={favicon} />

        <TabsContent value="tienda" keepMounted data-settings-tab="tienda" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Datos de la tienda</CardTitle>
              <CardDescription>País: Perú · Moneda: soles (S/) · Enlace: /p/{storeSlug}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre de la tienda">
                <Input name="name" defaultValue={initial.name} required />
              </Field>
              <Field label="WhatsApp" hint="Para que el cliente te escriba (botón de WhatsApp de tus landings y de la página de gracias).">
                <Input name="whatsapp" defaultValue={initial.whatsapp} placeholder="987 654 321" inputMode="tel" />
              </Field>
              <Field label="Teléfono">
                <Input name="phone" defaultValue={initial.phone} inputMode="tel" />
              </Field>
              <Field label="Correo">
                <Input name="email" type="email" defaultValue={initial.email} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Dirección">
                  <Input name="address" defaultValue={initial.address} />
                </Field>
              </div>
              <ImageField
                label="Logo"
                value={logo}
                onChange={(v) => {
                  setLogo(v);
                  markDirty();
                }}
                storeId={storeId}
                folder="brand"
                maxSize={600}
              />
              <ImageField
                label="Favicon (ícono de la pestaña)"
                value={favicon}
                onChange={(v) => {
                  setFavicon(v);
                  markDirty();
                }}
                storeId={storeId}
                folder="brand"
                maxSize={128}
              />
            </CardContent>
          </Card>

        </TabsContent>

        <TabsContent value="envios" keepMounted data-settings-tab="envios" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Contraentrega (COD)</CardTitle>
              <CardDescription>El envío se calcula en el servidor según el distrito: Lima Metropolitana y Callao pagan tarifa Lima.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="Envío Lima y Callao (S/)">
                <Input
                  name="shipping_lima"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={initial.shipping_lima}
                  onChange={(e) => setExample((x) => ({ ...x, lima: Number(e.target.value) || 0 }))}
                />
              </Field>
              <Field label="Envío provincias (S/)">
                <Input
                  name="shipping_province"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={initial.shipping_province}
                  onChange={(e) => setExample((x) => ({ ...x, province: Number(e.target.value) || 0 }))}
                />
              </Field>
              <Field label="Adelanto en provincia (S/)" hint="Lima es contraentrega: no lleva adelanto. 0 = sin adelanto">
                <Input
                  name="advance_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={initial.advance_amount}
                  onChange={(e) => setExample((x) => ({ ...x, advance: Number(e.target.value) || 0 }))}
                />
              </Field>
              <div className="rounded-lg bg-muted/50 p-3 text-sm sm:col-span-3">
                <p className="mb-1 font-medium">Ejemplo con un producto de {formatMoney(productPrice)}:</p>
                <p className="text-muted-foreground">
                  Lima: {formatMoney(productPrice)} + envío {formatMoney(example.lima)} = {formatMoney(total)}, se paga todo al recibir.
                </p>
                <p className="text-muted-foreground">
                  Provincia: {formatMoney(productPrice)} + envío {formatMoney(example.province)} = {formatMoney(provinceTotal)}
                  {example.advance > 0
                    ? ` · adelanto ${formatMoney(Math.min(example.advance, provinceTotal))} · saldo en agencia ${formatMoney(provinceTotal - Math.min(example.advance, provinceTotal))}`
                    : ", se paga todo en la agencia."}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Costos y cobro</CardTitle>
              <CardDescription>Lo que gastas en cada pedido que sale y cómo te puede pagar el cliente.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="Embalaje por unidad (S/)" hint="Bolsa, caja, cinta… Se suma al costo de cada pedido que sale y se descuenta de tu utilidad.">
                <Input name="packaging_cost" type="number" step="0.01" min="0" defaultValue={initial.packaging_cost} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Métodos de pago" hint="Separados por comas. Ej: Contraentrega, Yape, Plin">
                  <Input name="payment_methods" defaultValue={initial.payment_methods} />
                </Field>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="publicidad" keepMounted data-settings-tab="publicidad" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Gasto publicitario</CardTitle>
              <CardDescription>Moneda de tu cuenta publicitaria. Vendia convierte cada gasto a soles y guarda el tipo de cambio usado.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="Moneda de la cuenta">
                <AppSelect
                  name="ad_currency"
                  defaultValue={initial.ad_currency}
                  onChange={markDirty}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                  <option value="PEN">Soles (S/)</option>
                  <option value="USD">Dólares (US$)</option>
                </AppSelect>
              </Field>
              <Field label="Tipo de cambio (S/ por US$)" hint="Valor sugerido al registrar gastos en dólares. Lo puedes cambiar en cada gasto.">
                <Input name="usd_rate" type="number" step="0.0001" min="1" max="20" defaultValue={initial.usd_rate} required />
              </Field>
              <label className="flex items-center gap-2 self-center text-sm">
                <input type="checkbox" name="apply_igv" defaultChecked={initial.apply_igv} className="size-4" />
                Sumar IGV 18 % al gasto en publicidad
              </label>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pedidos" keepMounted data-settings-tab="pedidos" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Secuencia de contacto</CardTitle>
              <CardDescription>
                Cómo se confirma cada pedido. Los intentos se hacen seguidos; se puede cancelar desde el primero. Al terminar la secuencia sin respuesta,
                Vendia te avisa (no cancela solo).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-6">
              <Field label="Cantidad de llamadas">
                <Input name="contact_calls" type="number" min={0} max={6} defaultValue={initial.contact_calls} className="w-24" />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="contact_whatsapp" defaultChecked={initial.contact_whatsapp} className="size-4" />
                Terminar con un mensaje por WhatsApp
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Venta real</CardTitle>
              <CardDescription>
                Un pedido no es una venta. Elige cuándo cuenta como venta: se usa en todas tus métricas (CPA real, ROAS real, utilidad) y para enviar
                «Purchase» a Meta.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {(Object.entries(REAL_SALE_MODES) as [string, string][]).map(([value, label]) => (
                <label key={value} className="flex items-start gap-2 text-sm">
                  <input type="radio" name="real_sale_mode" value={value} defaultChecked={initial.real_sale_mode === value} className="mt-0.5 size-4" />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {value === "zone"
                        ? "Recomendado: en provincia el cliente ya pagó el saldo."
                        : "Más conservador: en provincia espera a que el cliente recoja su pedido."}
                    </span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Equipo</CardTitle>
              <CardDescription>Invita a quienes te ayudan a confirmar y despachar pedidos, y define qué puede ver cada uno.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/dashboard/equipo" className={buttonVariants({ variant: "outline" })}>
                <Users />
                Ir a Equipo
              </Link>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Barra de guardado fija abajo (sobre la barra de navegación en el celular) */}
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 flex items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur md:bottom-4">
          <p className={cn("min-w-0 text-xs text-muted-foreground sm:text-sm", errorTab && "text-destructive")} aria-live="polite">
            {errorTab
              ? `Hay un error en «${tabLabel(errorTab)}».`
              : dirty
                ? "Tienes cambios sin guardar."
                : "Se guardan juntas todas las pestañas."}
          </p>
          <Button type="submit" disabled={pending} className="shrink-0">
            {pending ? "Guardando…" : "Guardar configuración"}
          </Button>
        </div>
      </form>

      <TabsContent value="couriers" keepMounted data-settings-tab="couriers">
        {couriers}
      </TabsContent>
    </Tabs>
  );
}
