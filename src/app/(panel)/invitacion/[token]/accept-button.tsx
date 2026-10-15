"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acceptInvitation } from "./actions";

export function AcceptInvitationButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="lg"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await acceptInvitation(token);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success("¡Listo! Ya eres parte del equipo.");
          router.push("/dashboard/pedidos");
        })
      }
    >
      {pending ? "Aceptando…" : "Aceptar invitación"}
    </Button>
  );
}
