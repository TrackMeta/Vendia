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
