import { Skeleton } from "@/components/ui/skeleton";

/**
 * Se muestra al instante al cambiar de sección (el menú queda fijo) mientras el servidor
 * prepara la página. Sin esto, el clic parece no responder hasta que llegan los datos.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Cargando">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
