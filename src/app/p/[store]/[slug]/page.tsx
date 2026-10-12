import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { publicAssetUrl } from "@/lib/env";
import { abCookieName, pickVariant, variantUrl } from "@/modules/landing/ab";
import { angleKeyFromQuery, angleName, applyAngle, findAngle } from "@/modules/landing/angles";
import { savedPriceVariant, signPriceVariantB } from "@/modules/landing/price-test";
import { getPublicLanding, toRenderData } from "@/modules/landing/public-data";
import { AbRemember } from "@/modules/landing/render/ab-remember";
import { googleFontHref } from "@/modules/landing/fonts";
import { LandingRenderer } from "@/modules/landing/render/landing-renderer";

/** Prueba de precio: mitad y mitad (fuera del componente: es azar, no parte del render). */
function pickPriceVariant(): "A" | "B" {
  return Math.random() < 0.5 ? "A" : "B";
}

function firstImage(landing: NonNullable<Awaited<ReturnType<typeof getPublicLanding>>>): string | null {
  const block = landing.landing.content.page_blocks.find((b) => b.type === "image" && b.src);
  const path = block && block.type === "image" ? block.src : landing.product.images[0]?.path;
  return publicAssetUrl(path);
}

export async function generateMetadata({ params }: PageProps<"/p/[store]/[slug]">): Promise<Metadata> {
  const { store, slug } = await params;
  const landing = await getPublicLanding(store, slug);
  if (!landing) return { title: "Página no encontrada" };

  const image = firstImage(landing);
  const description = landing.product.description?.slice(0, 160) ?? `${landing.product.name} — paga al recibir. Envío a todo el Perú.`;
  return {
    title: { absolute: `${landing.landing.title} | ${landing.store.name}` },
    description,
    icons: landing.store.favicon_path ? { icon: publicAssetUrl(landing.store.favicon_path)! } : undefined,
    openGraph: {
      title: landing.landing.title,
      description,
      siteName: landing.store.name,
      type: "website",
      locale: "es_PE",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: { card: "summary_large_image", title: landing.landing.title, description, images: image ? [image] : undefined },
  };
}

export default async function PublicLandingPage({ params, searchParams }: PageProps<"/p/[store]/[slug]">) {
  const { store, slug } = await params;
  const query = await searchParams;
  const landing = await getPublicLanding(store, slug);
  if (!landing) notFound();

  // Prueba A/B: el visitante va a una variante según su peso y siempre ve la misma
  let remember: { cookie: string; slug: string } | null = null;
  const variants = landing.landing.ab_variants ?? [];
  const fromTest = typeof query.vab === "string" && /^[0-9a-f-]{36}$/i.test(query.vab) ? query.vab : null;
  if (fromTest) {
    remember = { cookie: abCookieName(fromTest), slug: landing.landing.slug };
  } else if (variants.length) {
    const cookie = abCookieName(landing.landing.id);
    const saved = (await cookies()).get(cookie)?.value;
    const chosen = saved && variants.some((v) => v.slug === saved) ? saved : pickVariant(variants);
    if (chosen && chosen !== landing.landing.slug) redirect(variantUrl(store, chosen, query, landing.landing.id));
    remember = { cookie, slug: landing.landing.slug };
  }

  // Ángulo: ?a=acne (o el antiguo ?angulo=acne) muestra esa versión (textos e imágenes); sin él, la versión principal
  const base = toRenderData(landing);
  const angle = findAngle(base.content, angleKeyFromQuery(query));
  // Prueba A/B de precio: cada visitante ve siempre la misma versión (cookie 30 días)
  const priceTest = landing.landing.settings?.price_test;
  const testing = Boolean(priceTest?.enabled && Object.keys(priceTest.offers ?? {}).length);
  const priceCookie = `vd_pt_${landing.landing.id.slice(0, 8)}`;
  let priceVariant: "A" | "B" | null = null;
  if (testing) {
    // Una «B» vieja sin firma no vale: se vuelve a sortear
    const saved = savedPriceVariant(landing.landing.id, (await cookies()).get(priceCookie)?.value);
    priceVariant = saved ?? pickPriceVariant();
  }
  // Lo que guarda la cookie y se manda con el pedido: "A" o la ficha B firmada (el visitante no puede inventarla)
  const priceToken = priceVariant === "B" ? signPriceVariantB(landing.landing.id) : priceVariant;
  const offers =
    priceVariant === "B"
      ? base.offers.map((o) => {
          const b = Number(priceTest?.offers?.[o.id]);
          return b > 0 ? { ...o, price: b } : o;
        })
      : base.offers;

  const data = {
    ...base,
    offers,
    priceVariant,
    // Solo la versión que ve el cliente: los demás ángulos no viajan a la página
    content: { ...applyAngle(base.content, angle?.key), angles: [] },
    angle: angleName(base.content, angle?.key, landing.landing.settings?.angle),
  };
  const fontHref = googleFontHref(data.content.theme.font);
  const heroImage = firstImage(landing);

  return (
    <>
      {fontHref ? (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href={fontHref} />
        </>
      ) : null}
      {heroImage ? <link rel="preload" as="image" href={heroImage} fetchPriority="high" /> : null}
      <div className="flex-1" style={{ backgroundColor: data.content.theme.pageBg }}>
        <LandingRenderer data={data} mode="live" priceToken={priceToken} />
        {remember ? <AbRemember cookie={remember.cookie} slug={remember.slug} /> : null}
        {priceToken ? <AbRemember cookie={priceCookie} slug={priceToken} /> : null}
      </div>
    </>
  );
}
