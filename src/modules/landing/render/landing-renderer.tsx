"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { captureAttribution } from "@/modules/attribution/capture";
import type { PageBlock } from "../schema";
import type { LandingRenderData } from "../types";
import { CodForm } from "./cod-form";
import {
  BenefitsBlockView,
  ButtonBlockView,
  CarouselBlockView,
  CountdownBlockView,
  DividerBlockView,
  FaqBlockView,
  HeadingBlockView,
  ImageBlockView,
  ImageTextBlockView,
  MarqueeBlockView,
  OrderButton,
  PriceBlockView,
  TestimonialsBlockView,
  TextBlockView,
} from "./page-blocks";

const FONT_STACK: Record<string, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  Poppins: "'Poppins', system-ui, sans-serif",
  Montserrat: "'Montserrat', system-ui, sans-serif",
  Inter: "'Inter', system-ui, sans-serif",
  Roboto: "'Roboto', system-ui, sans-serif",
};

export function googleFontHref(font: string): string | null {
  if (font === "system") return null;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;600;700;800;900&display=swap`;
}

/**
 * Renderiza una landing completa.
 * - mode "live": landing pública (formulario emergente a pantalla completa, captura atribución).
 * - mode "preview": vista previa dentro del editor (todo contenido en el marco del celular).
 */
export function LandingRenderer({
  data,
  mode,
  selectedBlockId,
  onSelectBlock,
  forceFormOpen,
}: {
  data: LandingRenderData;
  mode: "live" | "preview";
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string) => void;
  forceFormOpen?: boolean;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const { content } = data;
  const preview = mode === "preview";
  const popup = content.theme.formMode === "popup";
  const isOpen = popup && (formOpen || Boolean(forceFormOpen));

  useEffect(() => {
    if (!preview) captureAttribution();
  }, [preview]);

  useEffect(() => {
    if (preview || !isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen, preview]);

  const openForm = () => {
    if (popup) {
      setFormOpen(true);
    } else {
      document.getElementById("vd-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const hasEmbeddedBlock = content.page_blocks.some((b) => b.type === "embedded_form");
  const firstImageId = content.page_blocks.find((b) => b.type === "image" && b.src)?.id;

  const renderBlock = (block: PageBlock) => {
    const common = { onOrder: openForm };
    switch (block.type) {
      case "image": {
        return <ImageBlockView block={block} {...common} priority={block.id === firstImageId} />;
      }
      case "button":
        return <ButtonBlockView block={block} {...common} />;
      case "carousel":
        return <CarouselBlockView block={block} {...common} />;
      case "marquee":
        return <MarqueeBlockView block={block} {...common} />;
      case "heading":
        return <HeadingBlockView block={block} {...common} />;
      case "text":
        return <TextBlockView block={block} {...common} />;
      case "benefits":
        return <BenefitsBlockView block={block} {...common} />;
      case "image_text":
        return <ImageTextBlockView block={block} {...common} />;
      case "price": {
        const base = data.offers.find((o) => o.is_default) ?? data.offers[0];
        return (
          <PriceBlockView
            block={block}
            {...common}
            price={base?.price ?? data.product.price}
            compareAt={base?.compare_at_price ?? data.product.compare_at_price}
          />
        );
      }
      case "countdown":
        return <CountdownBlockView block={block} {...common} />;
      case "testimonials":
        return <TestimonialsBlockView block={block} {...common} />;
      case "faq":
        return <FaqBlockView block={block} {...common} />;
      case "divider":
        return <DividerBlockView block={block} {...common} />;
      case "embedded_form":
        return (
          <div id="vd-form" className="scroll-mt-4 bg-white px-4 py-5">
            <CodForm data={data} preview={preview} />
          </div>
        );
    }
  };

  return (
    <div
      className={`relative mx-auto w-full max-w-[480px] ${preview ? "min-h-full" : "min-h-svh"}`}
      style={{ fontFamily: FONT_STACK[content.theme.font], backgroundColor: content.theme.pageBg, color: content.theme.textColor }}
    >
      {content.page_blocks.map((block) => (
        <div
          key={block.id}
          onClickCapture={
            onSelectBlock
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectBlock(block.id);
                }
              : undefined
          }
          className={
            preview
              ? `relative cursor-pointer outline-offset-[-2px] hover:outline-2 hover:outline-dashed hover:outline-sky-400 ${
                  selectedBlockId === block.id ? "outline-2 outline-sky-500 outline-solid" : ""
                }`
              : undefined
          }
        >
          {renderBlock(block)}
        </div>
      ))}

      {/* Si el modo es "incrustado" y no hay bloque de formulario, lo agregamos al final */}
      {!popup && !hasEmbeddedBlock ? (
        <div id="vd-form" className="scroll-mt-4 bg-white px-4 py-5">
          <CodForm data={data} preview={preview} />
        </div>
      ) : null}

      {content.sticky_button.enabled ? (
        <div className="sticky bottom-0 z-30 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <OrderButton
            text={content.sticky_button.text}
            subtext={content.sticky_button.subtext}
            bg={content.sticky_button.bg}
            color={content.sticky_button.color}
            pulse
            onClick={openForm}
          />
        </div>
      ) : null}

      {isOpen ? (
        <div
          className={`fixed inset-0 z-50 flex items-end justify-center bg-black/60 ${preview ? "" : "sm:items-center"}`}
          onClick={() => setFormOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Formulario de pedido"
            onClick={(e) => e.stopPropagation()}
            className={`vd-sheet relative w-full max-w-[480px] overflow-y-auto rounded-t-2xl bg-white px-4 pt-10 pb-6 sm:rounded-2xl ${
              preview ? "max-h-[92%]" : "max-h-[92svh]"
            }`}
          >
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              aria-label="Cerrar"
              className="absolute top-2 right-2 rounded-full p-2 text-zinc-500 hover:bg-zinc-100"
            >
              <X className="size-5" />
            </button>
            <CodForm data={data} preview={preview} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
