import type { LandingContent, ThankYouUpsell } from "./schema";

/**
 * Lo que viaja a la página pública: SIN el costo de los adicionales ni de la oferta
 * de gracias (es dato interno del vendedor). El servidor lee el costo por su cuenta.
 * El tipo se mantiene para no duplicar el esquema, pero `cost` ya no existe en el objeto.
 */
export function publicUpsell(upsell: ThankYouUpsell): ThankYouUpsell {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se descarta a propósito
  const { cost, ...rest } = upsell;
  return rest as ThankYouUpsell;
}

export function stripContentCosts(content: LandingContent): LandingContent {
  return {
    ...content,
    form_blocks: content.form_blocks.map((block) =>
      block.type === "form_bumps"
        ? {
            ...block,
            items: block.items.map((item) => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se descarta a propósito
              const { cost, ...rest } = item;
              return rest as typeof item;
            }),
          }
        : block,
    ),
    ...(content.thank_you_upsell ? { thank_you_upsell: publicUpsell(content.thank_you_upsell) } : {}),
  };
}
