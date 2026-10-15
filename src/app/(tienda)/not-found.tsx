import Link from "next/link";

/** Página que no existe (link mal copiado, landing borrada o despublicada). */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-3 bg-background p-8 text-center">
      <p className="text-5xl font-semibold tracking-tight text-primary">404</p>
      <h1 className="text-xl font-semibold">Esta página no existe</h1>
      <p className="max-w-sm text-sm text-muted-foreground">Puede que el link esté mal copiado o que la página ya no esté publicada.</p>
      <Link href="/" className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
        Ir al inicio
      </Link>
    </main>
  );
}
