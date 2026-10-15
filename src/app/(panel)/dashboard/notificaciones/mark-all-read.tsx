"use client";

import { Check, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissNotifications, notifyNotificationsChanged } from "@/components/dashboard/notifications";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function MarkAllReadButton({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await createClient().rpc("mark_notifications_read", { p_store_id: storeId, p_ids: null });
          notifyNotificationsChanged();
          router.refresh();
        })
      }
    >
      <Check /> Marcar todas como leídas
    </Button>
  );
}

/** Borra todas las notificaciones (solo para ti; el resto del equipo las sigue viendo). */
export function DismissAllButton({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" disabled={pending} />}>
        <Trash2 /> Borrar todas
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Borrar todas las notificaciones?</AlertDialogTitle>
          <AlertDialogDescription>Se borran solo para ti: el resto de tu equipo las sigue viendo. Los pedidos no se tocan.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                if (await dismissNotifications(storeId, null)) {
                  setOpen(false);
                  router.refresh();
                }
              })
            }
          >
            Borrar todas
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Borra una notificación. */
export function DismissButton({ storeId, id }: { storeId: string; id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      disabled={pending}
      aria-label="Borrar notificación"
      title="Borrar"
      className="text-muted-foreground"
      onClick={() =>
        startTransition(async () => {
          if (await dismissNotifications(storeId, [id])) router.refresh();
        })
      }
    >
      <X />
    </Button>
  );
}
