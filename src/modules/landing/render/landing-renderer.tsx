"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { trackEvent } from "@/modules/analytics/track";
import { captureAttribution } from "@/modules/attribution/capture";
import { initPixel, trackPixel } from "@/modules/meta/pixel";
import { FONT_STACK } from "../fonts";
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
  ProductHeroBlockView,
  TestimonialsBlockView,
  TextBlockView,
  WhatsappFloat,
} from "./page-blocks";

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
  // Oferta elegida en el bloque «Producto»: el formulario la trae marcada
  const [preferredOfferId, setPreferredOfferId] = useState<string | null>(null);
  const { content } = data;
  const preview = mode === "preview";
  const popup = content.theme.formMode === "popup";
  const isOpen = popup && (formOpen || Boolean(forceFormOpen));

  const live = !preview && Boolean(data.landingId);
  const basePrice = (data.offers.find((o) => o.is_default) ?? data.offers[0])?.price ?? data.product.price;
  const contentParams = { content_ids: data.productId ? [data.productId] : [], content_type: "product", content_name: data.product.name, value: basePrice, currency: "PEN" };

  useEffect(() => {
    if (preview) return;
    captureAttribution();
    if (!data.landingId) return;
    if (data.pixelId) {
      initPixel(data.pixelId);
      trackPixel("PageView");
    }
    trackEvent(data.landingId, "page_view");

    // ViewContent: cuando el visitante realmente mira el producto (scroll o 4 segundos)
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      trackPixel("ViewContent", contentParams);
      trackEvent(data.landingId!, "view_content");
      window.removeEventListener("scroll", onScroll);
    };
    const onScroll = () => {
      if (window.scrollY > window.innerHeight * 0.3) fire();
    };
    const timer = setTimeout(fire, 4000);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar la landing
  }, [preview, data.landingId, data.pixelId]);

  useEffect(() => {
    if (preview || !isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen, preview]);

  const openForm = () => {
    if (live) {
      trackPixel("InitiateCheckout", contentParams);
      trackEvent(data.landingId!, "initiate_checkout");
    }
    if (popup) {
      setFormOpen(true);
    } else {
      document.getElementById("vd-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const hasEmbeddedBlock = content.page_blocks.some((b) => b.type === "embedded_form");
  // En la landing pública no se muestran bloques de imagen vacíos (en el editor sí, como recordatorio).
  const visibleBlocks = preview
    ? content.page_blocks
    : content.page_blocks.filter(
        (b) => !(b.type === "image" && !b.src) && !(b.type === "carousel" && !b.images.some((i) => i.src)),
      );
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
            <CodForm key={preferredOfferId ?? "base"} data={data} preview={preview} preferredOfferId={preferredOfferId} />
          </div>
        );
      case "product_hero":
        return (
          <ProductHeroBlockView
            block={block}
            {...common}
            product={data.product}
            offers={data.offers}
            selectedOfferId={preferredOfferId}
            onSelectOffer={setPreferredOfferId}
          />
        );
    }
  };

  return (
    <div
      className={`relative mx-auto w-full max-w-[480px] ${preview ? "min-h-full" : "min-h-svh"}`}
      style={{ fontFamily: FONT_STACK[content.theme.font], backgroundColor: content.theme.pageBg, color: content.theme.textColor }}
    >
      {visibleBlocks.map((block) => (
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
          <CodForm key={preferredOfferId ?? "base"} data={data} preview={preview} preferredOfferId={preferredOfferId} />
        </div>
      ) : null}

      {content.whatsapp_button?.enabled && data.whatsapp && !isOpen ? (
        <WhatsappFloat phone={data.whatsapp} message={content.whatsapp_button.message} size={content.whatsapp_button.size} raised={content.sticky_button.enabled} />
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
            <CodForm data={data} preview={preview} preferredOfferId={preferredOfferId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
