import { CheckCircle2, CircleSlash } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOwner } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { INTEGRATION_PROVIDERS } from "@/modules/integrations/registry";
import { WebhookControls } from "./webhook-controls";

export const metadata: Metadata = { title: "Integraciones" };

export default async function IntegrationsPage() {
  const { store } = await requireOwner();
  const supabase = await createClient();
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  const [{ data: integrations }, { data: logs }] = await Promise.all([
    supabase.from("integrations").select("provider, status, updated_at").eq("store_id", store.id),
    supabase
      .from("integration_logs")
      .select("id, provider, direction, operation, success, status_code, message, created_at")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const webhook = integrations?.find((i) => i.provider === "generic_webhook");
  const webhookUrl = `${origin}/api/webhooks/generic_webhook/${store.id}`;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Integraciones"
        description="Vendia es la fuente de verdad de tus pedidos. Las integraciones solo envían o actualizan estados."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {INTEGRATION_PROVIDERS.map((p) => (
          <Card key={p.id} className={p.available ? "" : "opacity-80"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {p.available ? <CheckCircle2 className="size-4 text-emerald-600" /> : <CircleSlash className="size-4 text-muted-foreground" />}
                {p.name}
                {p.id === "generic_webhook" && webhook?.status === "active" ? <SimpleBadge tone="success">Activo</SimpleBadge> : null}
              </CardTitle>
              <CardDescription>{p.description}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              {p.available ? (
                p.id === "csv_export" ? (
                  <Link href="/dashboard/logistica?vista=despachar" className="underline">
                    Ir a Logística → Por despachar
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Configúralo abajo.</span>
                )
              ) : (
                <p className="text-muted-foreground">
                  {p.unavailableReason}
                  {p.docsUrl ? (
                    <>
                      {" "}
                      <a href={p.docsUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        Fuente
                      </a>
                    </>
                  ) : null}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Webhook genérico</CardTitle>
          <CardDescription>
            Para que tu courier, motorizado o una automatización (Make, Zapier, n8n) actualice el estado de tus pedidos automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <WebhookControls active={webhook?.status === "active"} webhookUrl={webhookUrl} />
          <div className="flex flex-col gap-2">
            <p className="font-medium">Cómo llamarlo</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`POST ${webhookUrl}
Content-Type: application/json
x-vendia-signature: sha256=<HMAC-SHA256(secreto, cuerpo) en hex>

{
  "event_id": "courier-evt-0001",     // único: si se repite, se ignora
  "order_number": 1001,               // o "external_order_id"
  "status": "entregado",              // confirmado · preparando · enviado · en_ruta ·
                                      // entregado · cobrado · cancelado · no_entregado · devuelto
  "tracking_code": "GUIA-123",        // opcional
  "courier_name": "Motorizado Juan",  // opcional
  "note": "Entregado a la titular"    // opcional
}`}</pre>
            <p className="text-xs text-muted-foreground">
              Respuestas: 200 aplicado (o duplicado ignorado) · 401 firma inválida · 422 pedido no encontrado o cambio de estado no permitido. Cuando el
              pedido llega a tu estado de venta real, Vendia envía Purchase a Meta automáticamente.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registro de actividad</CardTitle>
        </CardHeader>
        <CardContent>
          {!logs?.length ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Sin actividad todavía.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Integración</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(l.created_at)}</TableCell>
                    <TableCell>
                      {l.provider} · {l.operation}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <SimpleBadge tone={l.success ? "success" : "danger"}>{l.status_code ?? (l.success ? "OK" : "Error")}</SimpleBadge>
                        <span className="max-w-72 truncate">{l.message}</span>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
