"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
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
          router.refresh();
        })
      }
    >
      <Check /> Marcar todas como leídas
    </Button>
  );
}
