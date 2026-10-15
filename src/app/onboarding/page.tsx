import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStore, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Crea tu tienda" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  await requireUser();
  // La sesión puede ser de una cuenta que ya no existe (borrada): se confirma con Supabase y, si no está, se cierra
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/auth/salir");

  const { nueva } = await searchParams;
  // ?nueva=1: crear otra tienda (un usuario puede tener varias)
  if (nueva !== "1" && (await getCurrentStore())) redirect("/dashboard");

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="flex w-full max-w-md flex-col gap-3">
        <OnboardingForm />
        <p className="text-center text-xs text-muted-foreground">
          Ingresaste como {data.user.email}.{" "}
          <Link href="/auth/salir" prefetch={false} className="font-medium text-foreground underline underline-offset-4">
            ¿No eres tú? Cerrar sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
