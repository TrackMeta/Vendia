import type { FormBlock, FormBlockType, LandingContent, PageBlock, PageBlockType } from "./schema";

export function newBlockId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const GREEN = "#16a34a";
const WHITE = "#ffffff";
const DARK = "#111111";

export function createPageBlock(type: PageBlockType): PageBlock {
  const id = newBlockId();
  switch (type) {
    case "image":
      return { id, type, src: "", alt: "", opensForm: false };
    case "button":
      return { id, type, text: "REALIZA TU PEDIDO", subtext: "Pagas al recibir · Envío a todo el Perú", bg: GREEN, color: WHITE, pulse: true };
    case "carousel":
      return { id, type, images: [], autoplay: true };
    case "marquee":
      return { id, type, text: "ENVÍO GRATIS A TODO EL PERÚ · PAGA AL RECIBIR", bg: DARK, color: WHITE };
    case "heading":
      return { id, type, text: "Título llamativo", size: "lg", align: "center", color: DARK, bg: WHITE };
    case "text":
      return { id, type, text: "Escribe aquí el texto.", align: "center", color: DARK, bg: WHITE };
    case "benefits":
      return { id, type, title: "Beneficios", items: ["Beneficio 1", "Beneficio 2", "Beneficio 3"], color: DARK, bg: WHITE };
    case "image_text":
      return { id, type, src: "", title: "Título", text: "Describe esta característica.", imageSide: "left", color: DARK, bg: WHITE };
    case "price":
      return { id, type, label: "Precio especial por tiempo limitado", showCompareAt: true, color: DARK, bg: WHITE };
    case "countdown":
      return { id, type, label: "La oferta termina en", minutes: 15, color: WHITE, bg: "#dc2626" };
    case "testimonials":
      return {
        id,
        type,
        title: "Lo que dicen nuestros clientes",
        items: [{ name: "Cliente satisfecho", time: "Hace 2 días", text: "Escribe aquí una reseña real de tu cliente.", avatar: "", rating: 5 }],
        bg: "#f4f4f5",
      };
    case "faq":
      return {
        id,
        type,
        title: "Preguntas frecuentes",
        items: [
          { q: "¿Cómo pago?", a: "Pagas en efectivo o Yape cuando recibes tu pedido." },
          { q: "¿Cuánto demora el envío?", a: "Lima: 24 a 48 horas. Provincias: 2 a 5 días hábiles." },
        ],
        color: DARK,
        bg: WHITE,
      };
    case "divider":
      return { id, type, height: 24, bg: WHITE, line: false };
    case "embedded_form":
      return { id, type };
  }
}

export function createFormBlock(type: FormBlockType): FormBlock {
  const id = newBlockId();
  switch (type) {
    case "form_image":
      return { id, type, src: "", alt: "" };
    case "form_text":
      return { id, type, text: "¡Pide ahora y paga al recibir!", align: "center" };
    case "form_offers":
      return { id, type, title: "Selecciona tu oferta" };
    case "form_fields":
      return { id, type, singleNameField: true, askDni: false, askWhatsapp: false, requireReference: true, askNotes: false };
    case "form_summary":
      return { id, type };
    case "form_submit":
      return { id, type, text: "CONFIRMAR PEDIDO", subtext: "Pagas al recibir", bg: GREEN, color: WHITE };
  }
}

/**
 * Plantilla "Landing COD clásica": el esqueleto típico en Perú.
 * Imágenes intercaladas con botones, prueba social al final,
 * botón fijo abajo y formulario emergente.
 */
export function createClassicTemplate(productImages: string[] = []): LandingContent {
  const img = (i: number) => ({ ...(createPageBlock("image") as Extract<PageBlock, { type: "image" }>), src: productImages[i] ?? "" });
  const button = () => createPageBlock("button");

  return {
    version: 1,
    theme: { font: "Poppins", pageBg: WHITE, textColor: DARK, accent: GREEN, formMode: "popup" },
    page_blocks: [
      createPageBlock("marquee"),
      img(0),
      button(),
      img(1),
      img(2),
      button(),
      img(3),
      img(4),
      button(),
      createPageBlock("testimonials"),
      createPageBlock("faq"),
      button(),
    ],
    form_blocks: [
      createFormBlock("form_text"),
      createFormBlock("form_offers"),
      createFormBlock("form_fields"),
      createFormBlock("form_summary"),
      createFormBlock("form_submit"),
    ],
    sticky_button: {
      enabled: true,
      text: "REALIZA TU PEDIDO",
      subtext: "Envío a todo el Perú · Pagas al recibir",
      bg: GREEN,
      color: WHITE,
    },
  };
}
