import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentStore, requireUser } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Crea tu tienda" };

export default async function OnboardingPage() {
  await requireUser();
  if (await getCurrentStore()) redirect("/dashboard");

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-md">
        <OnboardingForm />
      </div>
    </main>
  );
}
