import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordReset } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function RecoverPage() {
  return (
    <AuthForm
      title="Recuperar contraseña"
      description="Te enviaremos un enlace para crear una nueva."
      action={requestPasswordReset}
      submitLabel="Enviar enlace"
      fields={[{ name: "email", label: "Correo", type: "email", autoComplete: "email", placeholder: "tu@correo.com" }]}
      footer={
        <Link href="/login" className="underline underline-offset-4">
          Volver a ingresar
        </Link>
      }
    />
  );
}
