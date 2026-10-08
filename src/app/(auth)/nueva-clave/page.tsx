import type { Metadata } from "next";
import { updatePassword } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default function NewPasswordPage() {
  return (
    <AuthForm
      title="Crea una nueva contraseña"
      action={updatePassword}
      submitLabel="Guardar contraseña"
      fields={[
        { name: "password", label: "Nueva contraseña", type: "password", autoComplete: "new-password" },
        { name: "confirm", label: "Repite la contraseña", type: "password", autoComplete: "new-password" },
      ]}
    />
  );
}
