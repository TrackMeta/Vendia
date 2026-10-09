"use client";

import { CheckCircle2, KeyRound, Loader2, RefreshCw, Search, TriangleAlert, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import type { AdAccount, Pixel } from "@/modules/meta/marketing-api";
import { checkMetaToken, connectMeta, disconnectMeta, getMetaPixels, syncMetaNow } from "./actions";
import { BrandIcon } from "@/components/brand-icons";

export type MetaConnection = {
  connected: boolean;
  accountName: string | null;
  accountId: string | null;
  currency: string | null;
  userName: string | null;
  pixelId: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

const select = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/**
 * «Conectar Meta» con un token de usuario del sistema:
 * 1. pegar el token → 2. elegir la cuenta publicitaria → 3. elegir o crear el Pixel.
 * El token viaja solo al servidor de Vendia y se guarda cifrado; nunca se vuelve a mostrar.
 */
export function MetaConnect({ connection, storeName }: { connection: MetaConnection; storeName: string }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(!connection.connected);
  const [token, setToken] = useState("");
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [userName, setUserName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [pixels, setPixels] = useState<Pixel[] | null>(null);
  const [pixelChoice, setPixelChoice] = useState<string>("new");
  const [pixelName, setPixelName] = useState(`Pixel ${storeName}`);
  // true: cambiar de cuenta con el token ya guardado (no hay que volver a pegarlo)
  const [useSaved, setUseSaved] = useState(false);
  // El último error queda visible (el aviso flotante desaparece en segundos)
  const [error, setError] = useState<string | null>(null);
  // ID del Business Manager: solo se pide si Meta no nos dice a qué negocio pertenece el token
  const [needsBusiness, setNeedsBusiness] = useState(false);
  const [businessId, setBusinessId] = useState("");
  const tokenToSend = useSaved ? "" : token;

  const check = (saved = useSaved) =>
    startTransition(async () => {
      setError(null);
      const r = await checkMetaToken(saved ? "" : token, businessId);
      if (!r.ok) {
        toast.error(r.error);
        setError(r.error);
        if (r.needsBusinessId) setNeedsBusiness(true);
        return;
      }
      setUserName(r.userName);
      setAccounts(r.accounts);
      setAccountId("");
      setPixels(null);
      if (r.accounts.length === 1) loadPixels(r.accounts[0].id, saved);
    });

  const loadPixels = (id: string, saved = useSaved) => {
    setAccountId(id);
    setPixels(null);
    startTransition(async () => {
      const r = await getMetaPixels(saved ? "" : token, id, businessId);
      if (!r.ok) {
        toast.error(r.error);
        setError(r.error);
        return;
      }
      if (r.granted) {
        toast.success("Listo: Vendia se dio acceso a esta cuenta en tu Business Manager");
        setAccounts((list) => list?.map((a) => (a.id === id ? { ...a, assigned: true } : a)) ?? null);
      }
      setPixels(r.pixels);
      setPixelChoice(r.pixels[0]?.id ?? "new");
    });
  };

  const changeAccount = () => {
    setUseSaved(true);
    setEditing(true);
    check(true);
  };

  const changeToken = () => {
    setUseSaved(false);
    setAccounts(null);
    setPixels(null);
    setEditing(true);
  };

  const connect = () =>
    startTransition(async () => {
      const r = await connectMeta({
        token: tokenToSend,
        adAccountId: accountId,
        ...(pixelChoice === "new" ? { newPixelName: pixelName } : { pixelId: pixelChoice }),
      });
      if (!r.ok) {
        toast.error(r.error);
        setError(r.error);
        return;
      }
      toast.success(r.message ?? "Meta conectado");
      setToken("");
      setAccounts(null);
      setPixels(null);
      setEditing(false);
    });

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Listo");
      else toast.error(r.error ?? "Error");
    });

  const account = accounts?.find((a) => a.id === accountId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrandIcon name="meta" className="size-6" /> Conectar Meta
        </CardTitle>
        <CardDescription>
          Con un solo token, Vendia lee tus campañas y su gasto todos los días, usa tu Pixel y envía las conversiones. Nunca cambia tus campañas.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {connection.connected && !editing ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <CheckCircle2 className="size-5 text-emerald-600" />
              <span className="font-medium">{connection.accountName}</span>
              <SimpleBadge>{connection.currency}</SimpleBadge>
              <span className="text-muted-foreground">
                {connection.accountId} · Pixel {connection.pixelId}
                {connection.userName ? ` · token de ${connection.userName}` : ""}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Última sincronización: {connection.lastSyncAt ? formatDateTime(connection.lastSyncAt) : "en curso…"} · se actualiza sola cada día.
            </p>
            {connection.lastSyncError ? (
              <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">Último error: {connection.lastSyncError}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run(syncMetaNow)} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Actualizar ahora
              </Button>
              <Button variant="outline" onClick={changeAccount} disabled={pending}>
                <Search /> Cambiar cuenta publicitaria
              </Button>
              <Button variant="outline" onClick={changeToken} disabled={pending}>
                <KeyRound /> Cambiar token
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  if (confirm("¿Desconectar la cuenta publicitaria? Dejarás de sincronizar el gasto. Tus datos anteriores se conservan.")) run(disconnectMeta);
                }}
              >
                <Unplug /> Desconectar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {useSaved ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>Con tu token guardado. ¿Creaste una cuenta nueva? Aparece aquí: al elegirla, Vendia se da acceso sola.</span>
                <Button variant="outline" size="sm" onClick={() => check(true)} disabled={pending}>
                  {pending && !accountId ? <Loader2 className="animate-spin" /> : <RefreshCw />} Buscar cuentas
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                  <li>
                    En <b>developers.facebook.com → Mis apps → Crear app</b>, crea una app de tipo <b>Negocio</b> unida a tu Business Manager (es gratis y no
                    necesita revisión de Meta).
                  </li>
                  <li>
                    En tu <b>Business Manager → Configuración del negocio → Usuarios del sistema</b>, crea un usuario del sistema con rol <b>Administrador</b> y
                    asígnale la app. Como administrador, Vendia podrá darse acceso sola a las cuentas publicitarias que crees después.
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
                        setAccounts(null);
                        setPixels(null);
                      }}
                      className="min-w-0 flex-1"
                      placeholder="EAAB…"
                    />
                    <Button onClick={() => check(false)} disabled={pending || token.trim().length < 50}>
                      {pending && !accounts ? <Loader2 className="animate-spin" /> : null} Verificar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Se guarda cifrado y nadie (ni tu equipo) lo puede volver a ver.</p>
                  {error ? (
                    <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
                    </p>
                  ) : null}
                  {needsBusiness ? (
                    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
                      <Label htmlFor="meta-business">ID de tu Business Manager</Label>
                      <p className="text-xs text-muted-foreground">
                        Está en <b>business.facebook.com → Configuración del negocio → Información del negocio</b> (un número largo). Con él, Vendia encuentra
                        todas tus cuentas publicitarias y se da acceso sola.
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
                        <Button onClick={() => check(false)} disabled={pending || businessId.length < 5}>
                          {pending ? <Loader2 className="animate-spin" /> : <Search />} Buscar cuentas
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            )}

            {accounts ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="meta-account">Cuenta publicitaria {userName ? <span className="font-normal text-muted-foreground">· token de {userName}</span> : null}</Label>
                <select id="meta-account" value={accountId} onChange={(e) => loadPixels(e.target.value)} className={select}>
                  <option value="" disabled>
                    Elige la cuenta…
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                      {a.business ? ` · ${a.business}` : ""}
                      {a.status !== 1 ? " · (inactiva)" : ""}
                      {a.assigned ? "" : " · nueva: Vendia se dará acceso"}
                    </option>
                  ))}
                </select>
                {account ? (
                  <p className="text-xs text-muted-foreground">
                    Moneda {account.currency}: {account.currency === "USD" ? "el gasto se convertirá a soles con tu tipo de cambio." : "el gasto se registra en soles."}
                  </p>
                ) : null}
              </div>
            ) : null}

            {accountId && pixels === null && pending ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Buscando tus Pixels…
              </p>
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
                    {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Conectar y activar conversiones
                  </Button>
                  {connection.connected ? (
                    <Button variant="ghost" onClick={() => setEditing(false)}>
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
