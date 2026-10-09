import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentStore, requireUser } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Crea tu tienda" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  await requireUser();
  const { nueva } = await searchParams;
  // ?nueva=1: crear otra tienda (un usuario puede tener varias)
  if (nueva !== "1" && (await getCurrentStore())) redirect("/dashboard");

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md">
        <OnboardingForm />
      </div>
    </main>
  );
}
