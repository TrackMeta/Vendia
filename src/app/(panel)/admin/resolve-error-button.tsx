"use client";

import { Check } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resolveAppError } from "./actions";

export function ResolveErrorButton({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await resolveAppError(id);
          if (r.ok) toast.success(r.message ?? "Listo");
          else toast.error(r.error);
        })
      }
    >
      <Check /> Resuelto
    </Button>
  );
}
