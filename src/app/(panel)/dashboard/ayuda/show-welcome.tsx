"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { showWelcome } from "../welcome-actions";

export function ShowWelcomeButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      className="w-fit"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await showWelcome();
          router.push("/dashboard");
        })
      }
    >
      <Sparkles /> Ver la guía de bienvenida en Inicio
    </Button>
  );
}
