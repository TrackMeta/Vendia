import { z } from "zod";

/**
 * Estructura de una landing (se guarda en landing_pages.content como JSON).
 *
 *   content = { version, theme, page_blocks[], form_blocks[], sticky_button }
 *
 * - page_blocks: imágenes, botones, carrusel, etc. Todos los botones abren el formulario.
 * - form_blocks: el formulario COD (ventana emergente o incrustado), también por bloques.
 */

const id = z.string().min(1).max(40);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido");
const shortText = z.string().max(200);
const longText = z.string().max(4000);
const imagePath = z.string().max(500);
const align = z.enum(["left", "center", "right"]);

// ---------------------------------------------------------------------
// Bloques de la página
// ---------------------------------------------------------------------
export const imageBlock = z.object({
  id,
  type: z.literal("image"),
  src: imagePath,
  alt: shortText.default(""),
  /** Al tocar la imagen se abre el formulario */
  opensForm: z.boolean().default(false),
});

export const buttonBlock = z.object({
  id,
  type: z.literal("button"),
  text: shortText,
  subtext: shortText.default(""),
  bg: color,
  color,
  pulse: z.boolean().default(true),
});

export const carouselBlock = z.object({
  id,
  type: z.literal("carousel"),
  images: z.array(z.object({ src: imagePath, alt: shortText.default("") })).max(20),
  autoplay: z.boolean().default(true),
});

export const marqueeBlock = z.object({
  id,
  type: z.literal("marquee"),
  text: shortText,
  bg: color,
  color,
});

export const headingBlock = z.object({
  id,
  type: z.literal("heading"),
  text: shortText,
  size: z.enum(["md", "lg", "xl"]).default("lg"),
  align: align.default("center"),
  color,
  bg: color,
});

export const textBlock = z.object({
  id,
  type: z.literal("text"),
  text: longText,
  align: align.default("center"),
  color,
  bg: color,
});

export const benefitsBlock = z.object({
  id,
  type: z.literal("benefits"),
  title: shortText.default(""),
  items: z.array(shortText).max(20),
  color,
  bg: color,
});

export const imageTextBlock = z.object({
  id,
  type: z.literal("image_text"),
  src: imagePath,
  title: shortText.default(""),
  text: longText.default(""),
  imageSide: z.enum(["left", "right"]).default("left"),
  color,
  bg: color,
});

export const priceBlock = z.object({
  id,
  type: z.literal("price"),
  label: shortText.default(""),
  showCompareAt: z.boolean().default(true),
  color,
  bg: color,
});

export const countdownBlock = z.object({
  id,
  type: z.literal("countdown"),
  label: shortText,
  /** Cuenta regresiva por visitante (se reinicia al terminar) */
  minutes: z.number().int().min(1).max(1440),
  color,
  bg: color,
});

export const testimonialsBlock = z.object({
  id,
  type: z.literal("testimonials"),
  title: shortText.default(""),
  items: z
    .array(
      z.object({
        name: shortText,
        time: shortText.default(""),
        text: longText,
        avatar: imagePath.default(""),
        rating: z.number().int().min(0).max(5).default(5),
      }),
    )
    .max(30),
  bg: color,
});

export const faqBlock = z.object({
  id,
  type: z.literal("faq"),
  title: shortText.default("Preguntas frecuentes"),
  items: z.array(z.object({ q: shortText, a: longText })).max(30),
  color,
  bg: color,
});

export const dividerBlock = z.object({
  id,
  type: z.literal("divider"),
  height: z.number().int().min(0).max(200).default(24),
  bg: color,
  line: z.boolean().default(false),
});

/** Formulario incrustado en la página (además del emergente). */
export const embeddedFormBlock = z.object({
  id,
  type: z.literal("embedded_form"),
});

export const pageBlock = z.discriminatedUnion("type", [
  imageBlock,
  buttonBlock,
  carouselBlock,
  marqueeBlock,
  headingBlock,
  textBlock,
  benefitsBlock,
  imageTextBlock,
  priceBlock,
  countdownBlock,
  testimonialsBlock,
  faqBlock,
  dividerBlock,
  embeddedFormBlock,
]);

// ---------------------------------------------------------------------
// Bloques del formulario
// ---------------------------------------------------------------------
export const formImageBlock = z.object({ id, type: z.literal("form_image"), src: imagePath, alt: shortText.default("") });
export const formTextBlock = z.object({ id, type: z.literal("form_text"), text: longText, align: align.default("center") });
export const formOffersBlock = z.object({ id, type: z.literal("form_offers"), title: shortText.default("") });
export const formFieldsBlock = z.object({
  id,
  type: z.literal("form_fields"),
  /** Nombre y apellido en un solo campo ("Nombre completo") */
  singleNameField: z.boolean().default(true),
  askDni: z.boolean().default(false),
  askWhatsapp: z.boolean().default(false),
  requireReference: z.boolean().default(true),
  askNotes: z.boolean().default(false),
});
export const formSummaryBlock = z.object({ id, type: z.literal("form_summary") });
export const formSubmitBlock = z.object({
  id,
  type: z.literal("form_submit"),
  text: shortText,
  subtext: shortText.default(""),
  bg: color,
  color,
});

export const formBlock = z.discriminatedUnion("type", [
  formImageBlock,
  formTextBlock,
  formOffersBlock,
  formFieldsBlock,
  formSummaryBlock,
  formSubmitBlock,
]);

// ---------------------------------------------------------------------
// Landing completa
// ---------------------------------------------------------------------
export const FONTS = ["system", "Poppins", "Montserrat", "Inter", "Roboto"] as const;

export const landingTheme = z.object({
  font: z.enum(FONTS).default("Poppins"),
  pageBg: color.default("#ffffff"),
  textColor: color.default("#111111"),
  accent: color.default("#16a34a"),
  formMode: z.enum(["popup", "embedded"]).default("popup"),
});

export const stickyButton = z.object({
  enabled: z.boolean().default(true),
  text: shortText,
  subtext: shortText.default(""),
  bg: color,
  color,
});

const REQUIRED_FORM_BLOCKS = ["form_offers", "form_fields", "form_submit"] as const;

export const landingContent = z
  .object({
    version: z.literal(1),
    theme: landingTheme,
    page_blocks: z.array(pageBlock).max(80),
    form_blocks: z.array(formBlock).max(30),
    sticky_button: stickyButton,
  })
  .superRefine((content, ctx) => {
    for (const type of REQUIRED_FORM_BLOCKS) {
      const count = content.form_blocks.filter((b) => b.type === type).length;
      if (count !== 1) {
        ctx.addIssue({
          code: "custom",
          path: ["form_blocks"],
          message: `El formulario debe tener exactamente un bloque "${FORM_BLOCK_LABELS[type]}"`,
        });
      }
    }
    const ids = [...content.page_blocks, ...content.form_blocks].map((b) => b.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["page_blocks"], message: "Hay bloques con id repetido" });
    }
  });

export type PageBlock = z.infer<typeof pageBlock>;
export type PageBlockType = PageBlock["type"];
export type FormBlock = z.infer<typeof formBlock>;
export type FormBlockType = FormBlock["type"];
export type LandingTheme = z.infer<typeof landingTheme>;
export type StickyButton = z.infer<typeof stickyButton>;
export type LandingContent = z.infer<typeof landingContent>;

export const PAGE_BLOCK_LABELS: Record<PageBlockType, string> = {
  image: "Imagen",
  button: "Botón de pedido",
  carousel: "Carrusel de imágenes",
  marquee: "Barra animada",
  heading: "Título",
  text: "Texto",
  benefits: "Beneficios",
  image_text: "Imagen + texto",
  price: "Precio",
  countdown: "Contador",
  testimonials: "Testimonios",
  faq: "Preguntas frecuentes",
  divider: "Separador",
  embedded_form: "Formulario en la página",
};

export const FORM_BLOCK_LABELS: Record<FormBlockType, string> = {
  form_image: "Imagen",
  form_text: "Texto",
  form_offers: "Ofertas",
  form_fields: "Datos del cliente",
  form_summary: "Resumen del pedido",
  form_submit: "Botón confirmar",
};

/** Bloques del formulario que no se pueden eliminar ni duplicar. */
export const LOCKED_FORM_BLOCKS: FormBlockType[] = [...REQUIRED_FORM_BLOCKS];
