"use client";

import { CheckCircle2, KeyRound, Loader2, RefreshCw, Search, Settings2, TriangleAlert, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BrandIcon } from "@/components/brand-icons";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AdAccount, Pixel } from "@/modules/meta/marketing-api";
import { checkMetaToken, connectMeta, disconnectMeta, getMetaPixels, syncMetaNow, updateMetaAccounts } from "./actions";

export type ConnectedAccount = { id: string; name: string | null; currency: string | null; lastSyncAt: string | null; lastSyncError: string | null };

export type MetaConnection = {
  connected: boolean;
  /** Cuenta principal (la del Pixel). */
  accountId: string | null;
  accounts: ConnectedAccount[];
  userName: string | null;
  pixelId: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

const select = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

type Mode = "view" | "connect" | "accounts";

/** Lista de cuentas con casillas: se pueden elegir varias. */
function AccountPicker({ accounts, chosen, onToggle }: { accounts: AdAccount[]; chosen: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-col divide-y rounded-lg border">
      {accounts.map((a) => (
        <label key={a.id} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50", chosen.has(a.id) && "bg-muted/40")}>
          <input type="checkbox" checked={chosen.has(a.id)} onChange={() => onToggle(a.id)} className="size-4 accent-[#e53935]" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{a.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {a.id.replace("act_", "")}
              {a.business ? ` · ${a.business}` : ""}
              {a.status !== 1 ? " · inactiva" : ""}
            </span>
          </span>
          {a.assigned ? null : <SimpleBadge tone="info">Nueva: Vendia se dará acceso</SimpleBadge>}
          <SimpleBadge>{a.currency}</SimpleBadge>
        </label>
      ))}
    </div>
  );
}

/**
 * «Conectar Meta» con un token de usuario del sistema:
 * 1. pegar el token → 2. elegir una o varias cuentas publicitarias → 3. elegir o crear el Pixel.
 * Después se pueden agregar o quitar cuentas sin volver a pegar el token.
 * El token viaja solo al servidor de Vendia y se guarda cifrado; nunca se vuelve a mostrar.
 */
export function MetaConnect({ connection, storeName }: { connection: MetaConnection; storeName: string }) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(connection.connected ? "view" : "connect");
  const [token, setToken] = useState("");
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [userName, setUserName] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pixelAccount, setPixelAccount] = useState("");
  const [pixels, setPixels] = useState<Pixel[] | null>(null);
  const [pixelChoice, setPixelChoice] = useState<string>("new");
  const [pixelName, setPixelName] = useState(`Pixel ${storeName}`);
  // El último error queda visible (el aviso flotante desaparece en segundos)
  const [error, setError] = useState<string | null>(null);
  // ID del Business Manager: solo se pide si Meta no nos dice a qué negocio pertenece el token
  const [needsBusiness, setNeedsBusiness] = useState(false);
  const [businessId, setBusinessId] = useState("");
  const usingSaved = mode === "accounts";

  const fail = (message: string) => {
    toast.error(message);
    setError(message);
  };

  const reset = () => {
    setAccounts(null);
    setChosen(new Set());
    setPixels(null);
    setPixelAccount("");
    setError(null);
  };

  /** Busca las cuentas del token (pegado o guardado). */
  const check = (saved: boolean) =>
    startTransition(async () => {
      setError(null);
      const r = await checkMetaToken(saved ? "" : token, businessId);
      if (!r.ok) {
        fail(r.error);
        if (r.needsBusinessId) setNeedsBusiness(true);
        return;
      }
      setUserName(r.userName);
      setAccounts(r.accounts);
      setPixels(null);
      // Al administrar: marcadas las que ya están conectadas. Al conectar: si hay una sola, ya marcada.
      const initial = saved ? connection.accounts.map((a) => a.id) : r.accounts.length === 1 ? [r.accounts[0].id] : [];
      setChosen(new Set(initial.filter((id) => r.accounts.some((a) => a.id === id))));
      setPixelAccount(initial[0] ?? "");
    });

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
    setPixels(null);
    // La cuenta del Pixel siempre es una de las marcadas
    if (!next.has(pixelAccount)) setPixelAccount([...next][0] ?? "");
  };

  const loadPixels = () =>
    startTransition(async () => {
      setError(null);
      const r = await getMetaPixels(token, pixelAccount, businessId);
      if (!r.ok) return fail(r.error);
      if (r.granted) {
        toast.success("Listo: Vendia se dio acceso a esa cuenta en tu Business Manager");
        setAccounts((list) => list?.map((a) => (a.id === pixelAccount ? { ...a, assigned: true } : a)) ?? null);
      }
      setPixels(r.pixels);
      setPixelChoice(r.pixels[0]?.id ?? "new");
    });

  const connect = () =>
    startTransition(async () => {
      setError(null);
      // La cuenta del Pixel va primero: es la principal
      const ids = [pixelAccount, ...[...chosen].filter((id) => id !== pixelAccount)];
      const r = await connectMeta({
        token,
        adAccountIds: ids,
        businessId,
        ...(pixelChoice === "new" ? { newPixelName: pixelName } : { pixelId: pixelChoice }),
      });
      if (!r.ok) return fail(r.error);
      toast.success(r.message ?? "Meta conectado");
      setToken("");
      reset();
      setMode("view");
    });

  const saveAccounts = () =>
    startTransition(async () => {
      setError(null);
      const current = connection.accountId && chosen.has(connection.accountId) ? [connection.accountId] : [];
      const ids = [...current, ...[...chosen].filter((id) => !current.includes(id))];
      const r = await updateMetaAccounts({ adAccountIds: ids, businessId });
      if (!r.ok) return fail(r.error);
      toast.success(r.message ?? "Cuentas actualizadas");
      reset();
      setMode("view");
    });

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Listo");
      else toast.error(r.error ?? "Error");
    });

  const chosenAccounts = (accounts ?? []).filter((a) => chosen.has(a.id));
  const usd = chosenAccounts.some((a) => a.currency === "USD");

  const errorBox = error ? (
    <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
    </p>
  ) : null;

  const businessBox = needsBusiness ? (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      <Label htmlFor="meta-business">ID de tu Business Manager</Label>
      <p className="text-xs text-muted-foreground">
        Está en <b>business.facebook.com → Configuración del negocio → Información del negocio</b> (un número largo). Con él, Vendia encuentra todas tus cuentas
        publicitarias y se da acceso sola.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          id="meta-business"
          inputMode="numeric"
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value.replace(/\D/g, ""))}
          className="min-w-0 flex-1"
          placeholder="1234567890123456"
        />
        <Button onClick={() => check(usingSaved)} disabled={pending || businessId.length < 5}>
          {pending ? <Loader2 className="animate-spin" /> : <Search />} Buscar cuentas
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrandIcon name="meta" className="size-6" /> Conectar Meta
        </CardTitle>
        <CardDescription>
          Con un solo token, Vendia lee tus campañas y su gasto (de una o varias cuentas publicitarias), usa tu Pixel y envía las conversiones. Nunca cambia tus
          campañas.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {mode === "view" && connection.connected ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col divide-y rounded-lg border">
              {connection.accounts.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                  {a.lastSyncError ? <TriangleAlert className="size-4 shrink-0 text-destructive" /> : <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      {a.name ?? a.id}
                      {a.id === connection.accountId ? <span className="font-normal text-muted-foreground"> · principal (Pixel)</span> : null}
                    </span>
                    <span className={cn("truncate text-xs", a.lastSyncError ? "text-destructive" : "text-muted-foreground")}>
                      {a.lastSyncError ? a.lastSyncError : a.lastSyncAt ? `Leída ${formatDateTime(a.lastSyncAt)}` : "Leyendo por primera vez…"}
                    </span>
                  </span>
                  {a.currency ? <SimpleBadge>{a.currency}</SimpleBadge> : null}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Pixel {connection.pixelId}
              {connection.userName ? ` · token de ${connection.userName}` : ""} · Vendia lee tus cuentas cada mañana y cada vez que abres el panel (si pasó más de
              una hora).
            </p>
            {connection.lastSyncError ? <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">Último error: {connection.lastSyncError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run(syncMetaNow)} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Actualizar ahora
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  setMode("accounts");
                  check(true);
                }}
                disabled={pending}
              >
                <Settings2 /> Agregar o quitar cuentas
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  setMode("connect");
                }}
                disabled={pending}
              >
                <KeyRound /> Cambiar token
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  if (confirm("¿Desconectar Meta? Dejarás de sincronizar el gasto de todas tus cuentas. Tus datos anteriores se conservan.")) run(disconnectMeta);
                }}
              >
                <Unplug /> Desconectar
              </Button>
            </div>
          </div>
        ) : mode === "accounts" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Marca las cuentas publicitarias que usa esta tienda. Las nuevas traen sus últimos 30 días; las que quites dejan de leerse (su historial se queda).
            </p>
            {errorBox}
            {businessBox}
            {accounts ? (
              <AccountPicker accounts={accounts} chosen={chosen} onToggle={toggle} />
            ) : pending ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Buscando tus cuentas…
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveAccounts} disabled={pending || !chosen.size}>
                {pending && accounts ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Guardar cuentas ({chosen.size})
              </Button>
              <Button variant="outline" onClick={() => check(true)} disabled={pending}>
                <RefreshCw /> Buscar de nuevo
              </Button>
              <Button variant="ghost" onClick={() => setMode("view")}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                En <b>developers.facebook.com → Mis apps → Crear app</b>, crea una app de tipo <b>Negocio</b> unida a tu Business Manager (es gratis y no necesita
                revisión de Meta).
              </li>
              <li>
                En tu <b>Business Manager → Configuración del negocio → Usuarios del sistema</b>, crea un usuario del sistema con rol <b>Administrador</b> y asígnale
                la app. Como administrador, Vendia podrá darse acceso sola a tus cuentas publicitarias.
              </li>
              <li>
                «Generar nuevo token»: elige tu app y marca <b>ads_read</b>, <b>ads_management</b> y <b>business_management</b>. Cópialo y pégalo aquí.
              </li>
            </ol>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meta-token">Token del usuario del sistema</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="meta-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    reset();
                  }}
                  className="min-w-0 flex-1"
                  placeholder="EAAB…"
                />
                <Button onClick={() => check(false)} disabled={pending || token.trim().length < 50}>
                  {pending && !accounts ? <Loader2 className="animate-spin" /> : null} Verificar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Se guarda cifrado y nadie (ni tu equipo) lo puede volver a ver.</p>
            </div>
            {errorBox}
            {businessBox}

            {accounts ? (
              <div className="flex flex-col gap-2">
                <Label>
                  Cuentas publicitarias de esta tienda {userName ? <span className="font-normal text-muted-foreground">· token de {userName}</span> : null}
                </Label>
                <AccountPicker accounts={accounts} chosen={chosen} onToggle={toggle} />
                {usd ? <p className="text-xs text-muted-foreground">Las cuentas en USD se convierten a soles con tu tipo de cambio de Configuración.</p> : null}
              </div>
            ) : null}

            {chosen.size ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="meta-pixel-account">Cuenta del Pixel (principal)</Label>
                <div className="flex flex-wrap gap-2">
                  <select
                    id="meta-pixel-account"
                    value={pixelAccount}
                    onChange={(e) => {
                      setPixelAccount(e.target.value);
                      setPixels(null);
                    }}
                    className={cn(select, "min-w-0 flex-1")}
                  >
                    {chosenAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  {pixels === null ? (
                    <Button variant="outline" onClick={loadPixels} disabled={pending || !pixelAccount}>
                      {pending ? <Loader2 className="animate-spin" /> : null} Elegir Pixel
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {pixels ? (
              <div className="flex flex-col gap-2">
                <Label>Pixel</Label>
                {pixels.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="pixel" checked={pixelChoice === p.id} onChange={() => setPixelChoice(p.id)} className="size-4" />
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">
                      {p.id} · {p.lastFired ? `última actividad ${formatDateTime(p.lastFired)}` : "sin actividad"}
                    </span>
                  </label>
                ))}
                <label className="flex flex-wrap items-center gap-2 text-sm">
                  <input type="radio" name="pixel" checked={pixelChoice === "new"} onChange={() => setPixelChoice("new")} className="size-4" />
                  Crear un Pixel nuevo:
                  <Input value={pixelName} onChange={(e) => setPixelName(e.target.value)} className="h-8 max-w-60" disabled={pixelChoice !== "new"} />
                </label>
                <div className="flex gap-2">
                  <Button onClick={connect} disabled={pending || (pixelChoice === "new" && pixelName.trim().length < 2)}>
                    {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Conectar {chosen.size > 1 ? `${chosen.size} cuentas` : ""} y activar
                    conversiones
                  </Button>
                  {connection.connected ? (
                    <Button variant="ghost" onClick={() => setMode("view")}>
                      Cancelar
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
