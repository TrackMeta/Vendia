import Link from "next/link";
import { BrandLogo } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 px-6 py-24 text-center">
      <BrandLogo className="scale-125" />
      <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">Contraentrega · Perú</span>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Vende con landing pages y conoce tu <span className="text-primary">utilidad real</span>
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Crea tu landing, recibe pedidos COD con ubicaciones exactas del Perú y mide cuánto te cuesta cada venta
        entregada, no cada formulario.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/registro" className={buttonVariants({ size: "lg" })}>
          Crear mi tienda
        </Link>
        <Link href="/login" className={buttonVariants({ size: "lg", variant: "outline" })}>
          Ingresar
        </Link>
      </div>
    </main>
  );
}
