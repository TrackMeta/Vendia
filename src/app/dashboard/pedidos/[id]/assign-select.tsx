"use client";

import { UserCheck } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { assignOrders } from "../actions";

export function AssignSelect({
  orderId,
  assignedTo,
  members,
  currentUserId,
}: {
  orderId: string;
  assignedTo: string | null;
  members: { id: string; name: string }[];
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <UserCheck className="size-4" />
      <select
        value={assignedTo ?? ""}
        disabled={pending}
        onChange={(e) =>
          startTransition(async () => {
            const r = await assignOrders([orderId], e.target.value || null);
            if (r.ok) toast.success(r.message ?? "Asignado");
            else toast.error(r.error);
          })
        }
        className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
        aria-label="Asignado a"
      >
        <option value="">Sin asignar</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id === currentUserId ? `Yo (${m.name})` : m.name}
          </option>
        ))}
      </select>
    </label>
  );
}
