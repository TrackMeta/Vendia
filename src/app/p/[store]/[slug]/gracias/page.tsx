import { CheckCircle2, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicLanding } from "@/modules/landing/public-data";

export const metadata: Metadata = { title: { absolute: "¡Pedido recibido!" }, robots: { index: false } };

export default async function ThankYouPage({ params, searchParams }: PageProps<"/p/[store]/[slug]/gracias">) {
  const { store, slug } = await params;
  const { pedido } = await searchParams;
  const landing = await getPublicLanding(store, slug);
  if (!landing) notFound();

  const orderNumber = typeof pedido === "string" && /^\d{1,10}$/.test(pedido) ? pedido : null;
  const whatsapp = landing.store.whatsapp?.replace(/\D/g, "");
  const waNumber = whatsapp ? (whatsapp.length === 9 ? `51${whatsapp}` : whatsapp) : null;
  const waText = encodeURIComponent(
    `Hola ${landing.store.name}, acabo de hacer el pedido${orderNumber ? ` #${orderNumber}` : ""} de ${landing.product.name}.`,
  );

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white p-8 text-center shadow-sm">
        <CheckCircle2 className="size-16 text-green-600" />
        <h1 className="text-2xl font-extrabold text-zinc-900">¡Pedido recibido!</h1>
        {orderNumber ? <p className="text-sm text-zinc-500">Número de pedido: #{orderNumber}</p> : null}
        <p className="whitespace-pre-line text-base text-zinc-700">{landing.store.confirmation_message}</p>
        {waNumber ? (
          <a
            href={`https://wa.me/${waNumber}?text=${waText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 font-bold text-white"
          >
            <MessageCircle className="size-5" /> Escríbenos por WhatsApp
          </a>
        ) : null}
        <Link href={`/p/${store}/${slug}`} className="text-sm text-zinc-500 underline underline-offset-4">
          Volver a la página
        </Link>
      </div>
    </main>
  );
}
