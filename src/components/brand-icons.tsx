import { cn } from "@/lib/utils";

/**
 * Logos de servicios externos (public/brands, 96 px optimizados desde «Recursos Iconos»).
 * Se muestran pequeños para reconocer de un vistazo: WhatsApp, Meta y los couriers.
 */
const BRANDS = {
  whatsapp: { src: "/brands/whatsapp.png", alt: "WhatsApp", rounded: "" },
  meta: { src: "/brands/meta.png", alt: "Meta", rounded: "rounded-[22%]" },
  eva: { src: "/brands/eva.png", alt: "Eva", rounded: "rounded-[22%]" },
  shalom: { src: "/brands/shalom.png", alt: "Shalom", rounded: "rounded-full" },
} as const;

export type BrandName = keyof typeof BRANDS;

export function BrandIcon({ name, className, decorative = true }: { name: BrandName; className?: string; decorative?: boolean }) {
  const b = BRANDS[name];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- íconos fijos de 3-8 KB: no necesitan el optimizador de imágenes
    <img src={b.src} alt={decorative ? "" : b.alt} aria-hidden={decorative || undefined} width={20} height={20} className={cn("size-5 shrink-0 object-contain", b.rounded, className)} />
  );
}

/** Logo del courier si lo conocemos (Eva, Shalom); si no, nada. */
export function CourierIcon({ id, className }: { id: string | null | undefined; className?: string }) {
  return id === "eva" || id === "shalom" ? <BrandIcon name={id} className={className} /> : null;
}
