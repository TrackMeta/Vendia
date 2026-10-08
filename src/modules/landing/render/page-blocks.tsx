"use client";

import { ChevronDown, ImageIcon, ShoppingCart, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { publicAssetUrl } from "@/lib/env";
import { formatMoney } from "@/lib/format";
import type { PageBlock } from "../schema";

type BlockProps<T extends PageBlock["type"]> = {
  block: Extract<PageBlock, { type: T }>;
  onOrder: () => void;
  priority?: boolean;
};

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 bg-zinc-100 text-zinc-400">
      <ImageIcon className="size-8" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

export function ImageBlockView({ block, onOrder, priority }: BlockProps<"image">) {
  const src = publicAssetUrl(block.src);
  if (!src) return <Placeholder label="Sube una imagen" />;
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- imágenes ya optimizadas (WebP) en Supabase Storage
    <img
      src={src}
      alt={block.alt}
      className="block h-auto w-full"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
    />
  );
  return block.opensForm ? (
    <button type="button" onClick={onOrder} className="block w-full cursor-pointer">
      {img}
    </button>
  ) : (
    img
  );
}

export function OrderButton({
  text,
  subtext,
  bg,
  color,
  pulse,
  onClick,
  className = "",
}: {
  text: string;
  subtext?: string;
  bg: string;
  color: string;
  pulse?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ backgroundColor: bg, color }}
      className={`flex w-full flex-col items-center justify-center gap-0.5 rounded-xl px-4 py-3 text-center shadow-lg transition-transform active:scale-[0.98] ${pulse ? "vd-pulse" : ""} ${className}`}
    >
      <span className="flex items-center gap-2 text-lg font-extrabold leading-tight tracking-tight">
        <ShoppingCart className="size-5 shrink-0" />
        {text}
      </span>
      {subtext ? <span className="text-xs font-medium opacity-90">{subtext}</span> : null}
    </button>
  );
}

export function ButtonBlockView({ block, onOrder }: BlockProps<"button">) {
  return (
    <div className="px-4 py-3">
      <OrderButton {...block} onClick={onOrder} />
    </div>
  );
}

export function CarouselBlockView({ block }: BlockProps<"carousel">) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const images = block.images.filter((i) => i.src);

  useEffect(() => {
    if (!block.autoplay || images.length < 2) return;
    const timer = setInterval(() => {
      const el = ref.current;
      if (!el) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % images.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    }, 3500);
    return () => clearInterval(timer);
  }, [block.autoplay, images.length]);

  if (images.length === 0) return <Placeholder label="Agrega imágenes al carrusel" />;

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((image, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={publicAssetUrl(image.src)!} alt={image.alt} loading="lazy" className="block h-auto w-full shrink-0 snap-center" />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
        {images.map((_, i) => (
          <span key={i} className={`size-1.5 rounded-full ${i === index ? "bg-white" : "bg-white/50"}`} />
        ))}
      </div>
    </div>
  );
}

export function MarqueeBlockView({ block }: BlockProps<"marquee">) {
  const item = <span className="px-6">{block.text}</span>;
  return (
    <div style={{ backgroundColor: block.bg, color: block.color }} className="overflow-hidden py-2 text-sm font-bold">
      <div className="vd-marquee flex w-max whitespace-nowrap">
        {item}
        {item}
        {item}
        {item}
        {item}
        {item}
      </div>
    </div>
  );
}

const ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;

export function HeadingBlockView({ block }: BlockProps<"heading">) {
  const size = { md: "text-xl", lg: "text-2xl", xl: "text-3xl" }[block.size];
  return (
    <div style={{ backgroundColor: block.bg, color: block.color }} className="px-5 py-4">
      <h2 className={`${size} ${ALIGN[block.align]} font-extrabold leading-tight`}>{block.text}</h2>
    </div>
  );
}

export function TextBlockView({ block }: BlockProps<"text">) {
  return (
    <div style={{ backgroundColor: block.bg, color: block.color }} className="px-5 py-3">
      <p className={`${ALIGN[block.align]} whitespace-pre-line text-base leading-relaxed`}>{block.text}</p>
    </div>
  );
}

export function BenefitsBlockView({ block }: BlockProps<"benefits">) {
  return (
    <div style={{ backgroundColor: block.bg, color: block.color }} className="px-5 py-4">
      {block.title ? <h3 className="mb-3 text-center text-xl font-extrabold">{block.title}</h3> : null}
      <ul className="flex flex-col gap-2">
        {block.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-base">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-xs text-white">✓</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImageTextBlockView({ block }: BlockProps<"image_text">) {
  const src = publicAssetUrl(block.src);
  return (
    <div style={{ backgroundColor: block.bg, color: block.color }} className={`flex items-center gap-4 px-5 py-4 ${block.imageSide === "right" ? "flex-row-reverse" : ""}`}>
      <div className="w-2/5 shrink-0 overflow-hidden rounded-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt={block.title} loading="lazy" className="block h-auto w-full" /> : <Placeholder label="Imagen" />}
      </div>
      <div className="flex flex-col gap-1">
        {block.title ? <h3 className="text-lg font-bold leading-tight">{block.title}</h3> : null}
        <p className="whitespace-pre-line text-sm leading-relaxed opacity-90">{block.text}</p>
      </div>
    </div>
  );
}

export function PriceBlockView({ block, price, compareAt }: BlockProps<"price"> & { price: number; compareAt: number | null }) {
  return (
    <div style={{ backgroundColor: block.bg, color: block.color }} className="flex flex-col items-center gap-1 px-5 py-4 text-center">
      {block.label ? <span className="text-sm font-semibold uppercase tracking-wide opacity-80">{block.label}</span> : null}
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-black">{formatMoney(price)}</span>
        {block.showCompareAt && compareAt && compareAt > price ? (
          <span className="text-xl line-through opacity-60">{formatMoney(compareAt)}</span>
        ) : null}
      </div>
    </div>
  );
}

export function CountdownBlockView({ block }: BlockProps<"countdown">) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const key = `vd_cd_${block.id}`;
    const duration = block.minutes * 60_000;
    let end = 0;
    try {
      end = Number(localStorage.getItem(key)) || 0;
    } catch {}
    const reset = () => {
      end = Date.now() + duration;
      try {
        localStorage.setItem(key, String(end));
      } catch {}
    };
    if (end < Date.now() || end - Date.now() > duration) reset();
    const tick = () => {
      if (end <= Date.now()) reset();
      setRemaining(end - Date.now());
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [block.id, block.minutes]);

  const total = Math.max(0, Math.floor((remaining ?? block.minutes * 60_000) / 1000));
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map((n) => String(n).padStart(2, "0"));

  return (
    <div style={{ backgroundColor: block.bg, color: block.color }} className="flex flex-col items-center gap-1 px-4 py-3">
      <span className="text-sm font-semibold">{block.label}</span>
      <span className="font-mono text-3xl font-black tabular-nums">{parts.join(":")}</span>
    </div>
  );
}

export function TestimonialsBlockView({ block }: BlockProps<"testimonials">) {
  return (
    <div style={{ backgroundColor: block.bg }} className="px-4 py-5">
      {block.title ? <h3 className="mb-4 text-center text-xl font-extrabold text-zinc-900">{block.title}</h3> : null}
      <div className="flex flex-col gap-3">
        {block.items.map((item, i) => {
          const avatar = publicAssetUrl(item.avatar);
          return (
            <div key={i} className="rounded-xl bg-white p-3 text-zinc-900 shadow-sm">
              <div className="flex items-center gap-2">
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatar} alt={item.name} loading="lazy" className="size-9 rounded-full object-cover" />
                ) : (
                  <span className="flex size-9 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-600">
                    {item.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-semibold">{item.name}</span>
                  {item.time ? <span className="text-xs text-zinc-500">{item.time}</span> : null}
                </div>
              </div>
              {item.rating > 0 ? (
                <div className="mt-2 flex gap-0.5 text-amber-400">
                  {Array.from({ length: item.rating }).map((_, s) => (
                    <Star key={s} className="size-4 fill-current" />
                  ))}
                </div>
              ) : null}
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed">{item.text}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FaqBlockView({ block }: BlockProps<"faq">) {
  return (
    <div style={{ backgroundColor: block.bg, color: block.color }} className="px-5 py-5">
      {block.title ? <h3 className="mb-3 text-center text-xl font-extrabold">{block.title}</h3> : null}
      <div className="flex flex-col divide-y rounded-xl border border-current/15">
        {block.items.map((item, i) => (
          <details key={i} className="group px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold">
              {item.q}
              <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed opacity-90">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

export function DividerBlockView({ block }: BlockProps<"divider">) {
  return (
    <div style={{ backgroundColor: block.bg, height: block.height }} className="flex items-center px-5">
      {block.line ? <hr className="w-full border-zinc-300" /> : null}
    </div>
  );
}

/** Cabecera de product page: galería, nombre, precio, ofertas y botón de compra. */
export function ProductHeroBlockView({
  block,
  onOrder,
  product,
  offers,
  selectedOfferId,
  onSelectOffer,
}: BlockProps<"product_hero"> & {
  product: { name: string; price: number; compare_at_price: number | null; description?: string | null; images?: string[] };
  offers: { id: string; name: string; price: number; compare_at_price: number | null; badge: string | null; is_default: boolean }[];
  selectedOfferId: string | null;
  onSelectOffer: (id: string) => void;
}) {
  const images = (product.images ?? []).map((p) => publicAssetUrl(p)).filter((x): x is string => Boolean(x));
  const [index, setIndex] = useState(0);
  const offer = offers.find((o) => o.id === selectedOfferId) ?? offers.find((o) => o.is_default) ?? offers[0];
  const price = offer?.price ?? product.price;
  const compareAt = offer?.compare_at_price ?? product.compare_at_price;
  const discount = compareAt && compareAt > price ? Math.round((1 - price / compareAt) * 100) : null;

  return (
    <div className="flex flex-col gap-3 bg-white pb-4">
      <div className="relative">
        {images.length ? (
          // eslint-disable-next-line @next/next/no-img-element -- imágenes ya optimizadas (WebP) en Supabase Storage
          <img src={images[Math.min(index, images.length - 1)]} alt={product.name} className="block aspect-square w-full object-cover" fetchPriority="high" />
        ) : (
          <Placeholder label="Sube fotos al producto para la galería" />
        )}
        {block.badge || discount ? (
          <span className="absolute top-3 left-3 rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white">
            {block.badge || ""}
            {block.badge && discount ? " · " : ""}
            {discount ? `-${discount}%` : ""}
          </span>
        ) : null}
      </div>
      {images.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setIndex(i)}
              className={`size-16 shrink-0 overflow-hidden rounded-lg border-2 ${i === index ? "border-zinc-900" : "border-transparent"}`}
              aria-label={`Foto ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="size-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-1 px-4">
        <h1 className="text-xl leading-tight font-extrabold text-zinc-900">{product.name}</h1>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black text-zinc-900">{formatMoney(price)}</span>
          {compareAt && compareAt > price ? <span className="text-base text-zinc-400 line-through">{formatMoney(compareAt)}</span> : null}
        </div>
      </div>
      {offers.length > 1 ? (
        <div className="flex flex-col gap-2 px-4">
          {offers.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onSelectOffer(o.id)}
              className={`flex items-center justify-between rounded-xl border-2 px-3 py-2 text-left text-sm ${o.id === offer?.id ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}
            >
              <span className="font-semibold text-zinc-900">
                {o.name}
                {o.badge ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 uppercase">{o.badge}</span> : null}
              </span>
              <span className="font-bold text-zinc-900">{formatMoney(o.price)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="px-4">
        <OrderButton text={block.buttonText} subtext={block.buttonSubtext} bg={block.bg} color={block.color} pulse onClick={onOrder} />
      </div>
      {block.showDescription && product.description ? <p className="px-4 text-sm whitespace-pre-line text-zinc-600">{product.description}</p> : null}
    </div>
  );
}

/** Botón flotante de WhatsApp (abajo a la derecha). */
export function WhatsappFloat({ phone, message, size, raised }: { phone: string; message: string; size: number; raised: boolean }) {
  const digits = phone.replace(/\D/g, "");
  const number = digits.length === 9 ? `51${digits}` : digits;
  return (
    <a
      href={`https://wa.me/${number}?text=${encodeURIComponent(message)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Escríbenos por WhatsApp"
      className="fixed right-3 z-40 flex items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform active:scale-95"
      style={{ width: size, height: size, bottom: raised ? 96 : 16 }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size * 0.55, height: size * 0.55 }} aria-hidden="true">
        <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.9-9.88a9.83 9.83 0 0 1 6.99 2.9 9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.89 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.31-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.16-3.49-8.41" />
      </svg>
    </a>
  );
}
