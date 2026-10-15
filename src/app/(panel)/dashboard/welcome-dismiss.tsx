"use client";

import { X } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { dismissWelcome } from "./welcome-actions";

export function DismissWelcome() {
  const [pending, startTransition] = useTransition();
  return (
    <Button size="icon-sm" variant="ghost" disabled={pending} aria-label="Ocultar la guía de bienvenida" onClick={() => startTransition(() => dismissWelcome())}>
      <X />
    </Button>
  );
}
