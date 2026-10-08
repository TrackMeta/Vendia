"use client";

import { Copy, MessageCircle, Trash2, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteMember, removeMember, revokeInvitation } from "./actions";

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await inviteMember(email);
            if (r.ok) {
              setLink(r.link);
              setEmail("");
            } else toast.error(r.error);
          });
        }}
      >
        <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" className="max-w-xs" />
        <Button type="submit" disabled={pending}>
          <UserPlus /> {pending ? "Creando…" : "Crear invitación"}
        </Button>
      </form>
      {link ? (
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:bg-emerald-950">
          <p className="font-medium text-emerald-900 dark:text-emerald-100">Invitación lista. Envía este enlace:</p>
          <code className="rounded bg-white/70 p-2 text-xs break-all dark:bg-black/30">{link}</code>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(link);
                toast.success("Enlace copiado");
              }}
            >
              <Copy /> Copiar
            </Button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Te invito a trabajar los pedidos de mi tienda en Vendia: ${link}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md bg-[#25D366] px-3 py-1 text-sm font-semibold text-white"
            >
              <MessageCircle className="size-4" /> Enviar por WhatsApp
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RemoveMemberButton({ userId, name }: { userId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      disabled={pending}
      aria-label={`Quitar a ${name}`}
      onClick={() => {
        if (!confirm(`¿Quitar a ${name} del equipo?`)) return;
        startTransition(async () => {
          const r = await removeMember(userId);
          if (r.ok) toast.success(r.message ?? "Quitado");
          else toast.error(r.error);
        });
      }}
    >
      <Trash2 />
    </Button>
  );
}

export function RevokeInvitationButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await revokeInvitation(id);
          if (r.ok) toast.success(r.message ?? "Anulada");
          else toast.error(r.error);
        })
      }
    >
      Anular
    </Button>
  );
}
