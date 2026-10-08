import type { Metadata } from "next";
import Link from "next/link";
import { signup } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function SignupPage() {
  return (
    <AuthForm
      title="Crea tu cuenta"
      description="En el siguiente paso configuras tu tienda."
      action={signup}
      submitLabel="Crear cuenta"
      fields={[
        { name: "fullName", label: "Tu nombre", autoComplete: "name", placeholder: "Rodrigo Flores" },
        { name: "email", label: "Correo", type: "email", autoComplete: "email", placeholder: "tu@correo.com" },
        { name: "password", label: "Contraseña (mínimo 8 caracteres)", type: "password", autoComplete: "new-password" },
      ]}
      footer={
        <span>
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Ingresar
          </Link>
        </span>
      }
    />
  );
}
