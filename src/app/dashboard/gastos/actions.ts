"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EXPENSE_CATEGORIES } from "@/modules/expenses/categories";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const categories = Object.keys(EXPENSE_CATEGORIES) as [keyof typeof EXPENSE_CATEGORIES, ...(keyof typeof EXPENSE_CATEGORIES)[]];
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const expenseSchema = z.object({
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  category: z.enum(categories, "Elige una categoría"),
  description: optional(300),
  amount: z.coerce.number({ error: "Monto inválido" }).positive("El monto debe ser mayor a 0").max(10_000_000),
  campaign_id: optional(64),
  campaign_name: optional(255),
  product_id: z
    .union([z.literal(""), z.uuid()])
    .optional()
    .transform((v) => (v ? v : null)),
});

function revalidate() {
  revalidatePath("/dashboard/gastos");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/analitica");
}

export async function saveExpense(expenseId: string | null, _prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const { user, store } = await requireStore();
  const parsed = expenseSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = expenseId
    ? await supabase.from("expenses").update(parsed.data).eq("id", expenseId).eq("store_id", store.id)
    : await supabase.from("expenses").insert({ ...parsed.data, store_id: store.id, created_by: user.id });
  if (error) return { ok: false, error: "No se pudo guardar el gasto" };
  revalidate();
  return { ok: true, message: expenseId ? "Gasto actualizado" : "Gasto registrado" };
}

export async function deleteExpense(expenseId: string): Promise<ActionResult> {
  const { store } = await requireStore();
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").delete().eq("id", expenseId).eq("store_id", store.id);
  if (error) return { ok: false, error: "No se pudo eliminar" };
  revalidate();
  return { ok: true, message: "Gasto eliminado" };
}

const importSchema = z.object({
  productId: z.union([z.literal(""), z.uuid()]).optional(),
  rows: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        campaignId: z.string().max(64).nullable(),
        campaignName: z.string().max(255).nullable(),
        amount: z.number().positive().max(10_000_000),
        importKey: z.string().min(5).max(400),
      }),
    )
    .min(1)
    .max(5000),
});

/** Importa gasto de Meta Ads. Reimportar el mismo reporte actualiza los montos (no duplica). */
export async function importMetaExpenses(input: unknown): Promise<ActionResult> {
  const { user, store } = await requireStore();
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos de importación inválidos" };

  const supabase = await createClient();
  const rows = parsed.data.rows.map((r) => ({
    store_id: store.id,
    expense_date: r.date,
    category: "meta_ads" as const,
    description: r.campaignName ? `Meta Ads · ${r.campaignName}` : "Meta Ads",
    amount: r.amount,
    campaign_id: r.campaignId,
    campaign_name: r.campaignName,
    product_id: parsed.data.productId || null,
    source: "import" as const,
    import_key: r.importKey,
    created_by: user.id,
  }));
  const { error } = await supabase.from("expenses").upsert(rows, { onConflict: "store_id,import_key" });
  if (error) return { ok: false, error: "No se pudo importar el gasto" };
  revalidate();
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return { ok: true, message: `Importadas ${rows.length} filas · S/ ${total.toFixed(2)}` };
}
