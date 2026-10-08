"use client";

import { ImageDropzone } from "@/components/dashboard/image-dropzone";
import { publicAssetUrl } from "@/lib/env";
import type { FormBlock, PageBlock } from "@/modules/landing/schema";
import { ColorField, ImageField, ListEditor, NumberField, SelectField, TextField, ToggleField } from "@/components/dashboard/fields";

const ALIGN_OPTIONS = [
  { value: "left" as const, label: "Izquierda" },
  { value: "center" as const, label: "Centro" },
  { value: "right" as const, label: "Derecha" },
];

type Ctx = { storeId: string; folder: string };

function Colors<T extends { color: string; bg: string }>({ block, set }: { block: T; set: (patch: Partial<T>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <ColorField label="Texto" value={block.color} onChange={(color) => set({ color } as Partial<T>)} />
      <ColorField label="Fondo" value={block.bg} onChange={(bg) => set({ bg } as Partial<T>)} />
    </div>
  );
}

export function PageBlockInspector({ block, onChange, ctx }: { block: PageBlock; onChange: (block: PageBlock) => void; ctx: Ctx }) {
  const set = <T extends PageBlock>(patch: Partial<T>) => onChange({ ...block, ...patch } as PageBlock);

  switch (block.type) {
    case "image":
      return (
        <div className="flex flex-col gap-4">
          <ImageField label="Imagen" value={block.src} onChange={(src) => set({ src })} storeId={ctx.storeId} folder={ctx.folder} />
          <TextField label="Texto alternativo (accesibilidad)" value={block.alt} onChange={(alt) => set({ alt })} />
          <ToggleField label="Abrir el formulario al tocar la imagen" checked={block.opensForm} onChange={(opensForm) => set({ opensForm })} />
        </div>
      );
    case "button":
      return (
        <div className="flex flex-col gap-4">
          <TextField label="Texto del botón" value={block.text} onChange={(text) => set({ text })} />
          <TextField label="Subtítulo" value={block.subtext} onChange={(subtext) => set({ subtext })} />
          <Colors block={block} set={set} />
          <ToggleField label="Animación de latido" checked={block.pulse} onChange={(pulse) => set({ pulse })} />
        </div>
      );
    case "carousel":
      return (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            {block.images.map((img, i) => (
              <div key={i} className="relative overflow-hidden rounded border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={publicAssetUrl(img.src) ?? ""} alt="" className="aspect-square w-full object-cover" />
                <button
                  type="button"
                  className="absolute top-0.5 right-0.5 rounded bg-white/90 px-1 text-xs"
                  onClick={() => set({ images: block.images.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <ImageDropzone
            compact
            storeId={ctx.storeId}
            folder={ctx.folder}
            label="Agregar imágenes al carrusel"
            onUploaded={(imgs) => set({ images: [...block.images, ...imgs.map((i) => ({ src: i.path, alt: "" }))].slice(0, 20) })}
          />
          <ToggleField label="Avanzar automáticamente" checked={block.autoplay} onChange={(autoplay) => set({ autoplay })} />
        </div>
      );
    case "marquee":
      return (
        <div className="flex flex-col gap-4">
          <TextField label="Texto" value={block.text} onChange={(text) => set({ text })} />
          <Colors block={block} set={set} />
        </div>
      );
    case "heading":
      return (
        <div className="flex flex-col gap-4">
          <TextField label="Título" value={block.text} onChange={(text) => set({ text })} multiline />
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Tamaño"
              value={block.size}
              onChange={(size) => set({ size })}
              options={[
                { value: "md", label: "Mediano" },
                { value: "lg", label: "Grande" },
                { value: "xl", label: "Muy grande" },
              ]}
            />
            <SelectField label="Alineación" value={block.align} onChange={(align) => set({ align })} options={ALIGN_OPTIONS} />
          </div>
          <Colors block={block} set={set} />
        </div>
      );
    case "text":
      return (
        <div className="flex flex-col gap-4">
          <TextField label="Texto" value={block.text} onChange={(text) => set({ text })} multiline />
          <SelectField label="Alineación" value={block.align} onChange={(align) => set({ align })} options={ALIGN_OPTIONS} />
          <Colors block={block} set={set} />
        </div>
      );
    case "benefits":
      return (
        <div className="flex flex-col gap-4">
          <TextField label="Título" value={block.title} onChange={(title) => set({ title })} />
          <ListEditor
            label="Beneficios"
            items={block.items}
            onChange={(items) => set({ items })}
            createItem={() => "Nuevo beneficio"}
            addLabel="Agregar beneficio"
            renderItem={(item, _u, index) => (
              <TextField
                label={`Beneficio ${index + 1}`}
                value={item}
                onChange={(v) => set({ items: block.items.map((it, i) => (i === index ? v : it)) })}
              />
            )}
          />
          <Colors block={block} set={set} />
        </div>
      );
    case "image_text":
      return (
        <div className="flex flex-col gap-4">
          <ImageField label="Imagen" value={block.src} onChange={(src) => set({ src })} storeId={ctx.storeId} folder={ctx.folder} maxSize={900} />
          <TextField label="Título" value={block.title} onChange={(title) => set({ title })} />
          <TextField label="Texto" value={block.text} onChange={(text) => set({ text })} multiline />
          <SelectField
            label="Imagen a la"
            value={block.imageSide}
            onChange={(imageSide) => set({ imageSide })}
            options={[
              { value: "left", label: "Izquierda" },
              { value: "right", label: "Derecha" },
            ]}
          />
          <Colors block={block} set={set} />
        </div>
      );
    case "price":
      return (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">Muestra el precio de la oferta predeterminada del producto.</p>
          <TextField label="Texto superior" value={block.label} onChange={(label) => set({ label })} />
          <ToggleField label="Mostrar precio tachado" checked={block.showCompareAt} onChange={(showCompareAt) => set({ showCompareAt })} />
          <Colors block={block} set={set} />
        </div>
      );
    case "countdown":
      return (
        <div className="flex flex-col gap-4">
          <TextField label="Texto" value={block.label} onChange={(label) => set({ label })} />
          <NumberField label="Duración" value={block.minutes} onChange={(minutes) => set({ minutes })} min={1} max={1440} suffix="minutos" />
          <p className="text-xs text-muted-foreground">Cada visitante ve su propio contador; se reinicia al terminar.</p>
          <Colors block={block} set={set} />
        </div>
      );
    case "testimonials":
      return (
        <div className="flex flex-col gap-4">
          <TextField label="Título" value={block.title} onChange={(title) => set({ title })} />
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Usa reseñas reales. Meta puede rechazar anuncios o restringir tu cuenta por testimonios engañosos.
          </p>
          <ListEditor
            label="Testimonios"
            items={block.items}
            onChange={(items) => set({ items })}
            max={30}
            addLabel="Agregar testimonio"
            createItem={() => ({ name: "Nombre", time: "", text: "", avatar: "", rating: 5 })}
            renderItem={(item, update) => (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Nombre" value={item.name} onChange={(name) => update({ name })} />
                  <TextField label="Fecha" value={item.time} onChange={(time) => update({ time })} placeholder="Hace 2 días" />
                </div>
                <TextField label="Comentario" value={item.text} onChange={(text) => update({ text })} multiline />
                <NumberField label="Estrellas" value={item.rating} onChange={(rating) => update({ rating })} min={0} max={5} />
                <ImageField label="Foto (opcional)" value={item.avatar} onChange={(avatar) => update({ avatar })} storeId={ctx.storeId} folder={ctx.folder} maxSize={200} />
              </div>
            )}
          />
          <ColorField label="Fondo" value={block.bg} onChange={(bg) => set({ bg })} />
        </div>
      );
    case "faq":
      return (
        <div className="flex flex-col gap-4">
          <TextField label="Título" value={block.title} onChange={(title) => set({ title })} />
          <ListEditor
            label="Preguntas"
            items={block.items}
            onChange={(items) => set({ items })}
            max={30}
            addLabel="Agregar pregunta"
            createItem={() => ({ q: "Nueva pregunta", a: "" })}
            renderItem={(item, update) => (
              <div className="flex flex-col gap-2">
                <TextField label="Pregunta" value={item.q} onChange={(q) => update({ q })} />
                <TextField label="Respuesta" value={item.a} onChange={(a) => update({ a })} multiline />
              </div>
            )}
          />
          <Colors block={block} set={set} />
        </div>
      );
    case "divider":
      return (
        <div className="flex flex-col gap-4">
          <NumberField label="Alto" value={block.height} onChange={(height) => set({ height })} min={0} max={200} suffix="px" />
          <ToggleField label="Mostrar línea" checked={block.line} onChange={(line) => set({ line })} />
          <ColorField label="Fondo" value={block.bg} onChange={(bg) => set({ bg })} />
        </div>
      );
    case "embedded_form":
      return (
        <p className="text-sm text-muted-foreground">
          Muestra el formulario directamente en la página. Se configura en la pestaña «Formulario».
        </p>
      );
  }
}

export function FormBlockInspector({ block, onChange, ctx }: { block: FormBlock; onChange: (block: FormBlock) => void; ctx: Ctx }) {
  const set = <T extends FormBlock>(patch: Partial<T>) => onChange({ ...block, ...patch } as FormBlock);

  switch (block.type) {
    case "form_image":
      return (
        <div className="flex flex-col gap-4">
          <ImageField label="Imagen" value={block.src} onChange={(src) => set({ src })} storeId={ctx.storeId} folder={ctx.folder} maxSize={1000} />
          <TextField label="Texto alternativo" value={block.alt} onChange={(alt) => set({ alt })} />
        </div>
      );
    case "form_text":
      return (
        <div className="flex flex-col gap-4">
          <TextField label="Texto" value={block.text} onChange={(text) => set({ text })} multiline />
          <SelectField label="Alineación" value={block.align} onChange={(align) => set({ align })} options={ALIGN_OPTIONS} />
        </div>
      );
    case "form_offers":
      return (
        <div className="flex flex-col gap-4">
          <TextField label="Título" value={block.title} onChange={(title) => set({ title })} />
          <p className="text-xs text-muted-foreground">
            Las ofertas (unidades, precios, etiquetas) se editan en el producto. Así el precio siempre es el mismo en todas tus
            landings y se valida en el servidor.
          </p>
        </div>
      );
    case "form_fields":
      return (
        <div className="flex flex-col gap-1">
          <p className="mb-2 text-xs text-muted-foreground">
            Siempre se piden: nombre, celular, departamento/provincia/distrito y dirección.
          </p>
          <ToggleField label="Nombre completo en un solo campo" checked={block.singleNameField} onChange={(singleNameField) => set({ singleNameField })} />
          <ToggleField label="Referencia obligatoria" checked={block.requireReference} onChange={(requireReference) => set({ requireReference })} />
          <ToggleField label="Pedir DNI" checked={block.askDni} onChange={(askDni) => set({ askDni })} />
          <ToggleField label="Pedir otro número de WhatsApp" checked={block.askWhatsapp} onChange={(askWhatsapp) => set({ askWhatsapp })} />
          <ToggleField label="Campo de observaciones" checked={block.askNotes} onChange={(askNotes) => set({ askNotes })} />
        </div>
      );
    case "form_summary":
      return (
        <p className="text-sm text-muted-foreground">
          Muestra subtotal, envío (Lima o provincia según el distrito), total y, si configuraste adelanto, el saldo a pagar al
          recibir. Los montos de envío y adelanto se editan en Configuración.
        </p>
      );
    case "form_submit":
      return (
        <div className="flex flex-col gap-4">
          <TextField label="Texto del botón" value={block.text} onChange={(text) => set({ text })} />
          <TextField label="Subtítulo" value={block.subtext} onChange={(subtext) => set({ subtext })} />
          <Colors block={block} set={set} />
        </div>
      );
  }
}
