import type { Metadata } from "next";
import Link from "next/link";
import { login } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <AuthForm
      title="Ingresar"
      description="Accede al panel de tu tienda."
      action={login}
      submitLabel="Ingresar"
      hidden={{ next: typeof next === "string" ? next : "/dashboard" }}
      fields={[
        { name: "email", label: "Correo", type: "email", autoComplete: "email", placeholder: "tu@correo.com" },
        { name: "password", label: "Contraseña", type: "password", autoComplete: "current-password" },
      ]}
      footer={
        <div className="flex flex-col gap-2">
          <Link href="/recuperar" className="underline underline-offset-4">
            ¿Olvidaste tu contraseña?
          </Link>
          <span>
            ¿No tienes cuenta?{" "}
            <Link href="/registro" className="font-medium text-foreground underline underline-offset-4">
              Crea tu tienda
            </Link>
          </span>
        </div>
      }
    />
  );
}
