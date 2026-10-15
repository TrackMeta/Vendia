"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteProduct } from "../actions";

export function DeleteProductButton({ productId }: { productId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="destructive"
      disabled={pending}
      onClick={() => {
        if (!confirm("¿Eliminar este producto? Esta acción no se puede deshacer.")) return;
        startTransition(async () => {
          const result = await deleteProduct(productId);
          if (result && !result.ok) toast.error(result.error);
        });
      }}
    >
      <Trash2 /> Eliminar producto
    </Button>
  );
}
