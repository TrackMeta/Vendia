"use client";

import { MessageCircle, X } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markAbandoned } from "./actions";

export function AbandonedActions({ id, whatsappHref, contacted }: { id: string; whatsappHref: string; contacted: boolean }) {
  const [pending, startTransition] = useTransition();
  const mark = (status: "contacted" | "dismissed") =>
    startTransition(async () => {
      const r = await markAbandoned(id, status);
      if (!r.ok) toast.error(r.error);
    });
  return (
    <div className="flex items-center gap-2">
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => (contacted ? undefined : mark("contacted"))}
        className="flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-sm font-semibold text-white"
      >
        <MessageCircle className="size-4" /> {contacted ? "Escribir de nuevo" : "Escribir"}
      </a>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => mark("dismissed")}>
        <X /> Descartar
      </Button>
    </div>
  );
}
