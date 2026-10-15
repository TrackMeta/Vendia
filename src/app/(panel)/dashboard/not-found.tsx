import { SearchX } from "lucide-react";
import Link from "next/link";

/** Pedido, producto, landing o cliente que no existe (o es de otra tienda): dentro del panel, en español. */
export default function DashboardNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
      <SearchX className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-lg font-semibold">No encontramos lo que buscas</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Puede que se haya eliminado, que el link esté incompleto o que sea de otra de tus tiendas (revisa la tienda elegida arriba a la izquierda).
      </p>
      <Link href="/dashboard" className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
        Volver al inicio
      </Link>
    </div>
  );
}
