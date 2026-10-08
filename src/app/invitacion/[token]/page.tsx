import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AcceptInvitationButton } from "./accept-button";

export const metadata: Metadata = { title: "Invitación", robots: { index: false } };

export default async function InvitationPage({ params }: PageProps<"/invitacion/[token]">) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data }, user] = await Promise.all([supabase.rpc("get_invitation", { p_token: token }), getUser()]);
  const inv = data as { store_name: string; email: string; expired: boolean; accepted: boolean } | null;
  const next = encodeURIComponent(`/invitacion/${token}`);

  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{inv ? `Te invitaron a ${inv.store_name}` : "Invitación no válida"}</CardTitle>
          {inv ? (
            <CardDescription>
              Como <b>Confirmador</b>: verás y trabajarás los pedidos, la logística y los clientes. Invitación para <b>{inv.email}</b>.
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!inv ? (
            <p className="text-sm text-muted-foreground">El enlace no existe. Pide una nueva invitación al dueño de la tienda.</p>
          ) : inv.accepted ? (
            <p className="text-sm text-muted-foreground">Esta invitación ya fue usada.</p>
          ) : inv.expired ? (
            <p className="text-sm text-muted-foreground">La invitación venció. Pide una nueva al dueño de la tienda.</p>
          ) : user ? (
            user.email?.toLowerCase() === inv.email ? (
              <AcceptInvitationButton token={token} />
            ) : (
              <p className="text-sm text-amber-700">
                Ingresaste como {user.email}, pero la invitación es para {inv.email}. Cierra sesión e ingresa con ese correo.
              </p>
            )
          ) : (
            <div className="flex flex-col gap-2">
              <Link href={`/login?next=${next}`} className={buttonVariants()}>
                Ya tengo cuenta: ingresar
              </Link>
              <Link href={`/registro?next=${next}&email=${encodeURIComponent(inv.email)}`} className={buttonVariants({ variant: "outline" })}>
                Crear mi cuenta con {inv.email}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
