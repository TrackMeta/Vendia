import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import { DateRangeFilter, rangeParams } from "@/components/dashboard/date-range-filter";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOwner } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { EXPENSE_CATEGORIES, type ExpenseCategory, REFERENCE_ONLY_CATEGORIES } from "@/modules/expenses/categories";
import { resolveRange } from "@/modules/metrics/date-range";
import { type AdDefaults, DeleteExpenseButton, ExpenseDialog, ImportMetaDialog } from "./expense-dialogs";

export const metadata: Metadata = { title: "Gastos" };

export default async function ExpensesPage({ searchParams }: PageProps<"/dashboard/gastos">) {
  const sp = await searchParams;
  const rp = rangeParams(sp);
  const range = resolveRange(rp.rango, rp.desde, rp.hasta);
  const { store } = await requireOwner();
  const supabase = await createClient();

  const [{ data: expenses }, { data: totals }, { data: products }, { data: settings }] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id, expense_date, category, description, amount, currency, exchange_rate, igv_rate, amount_pen, campaign_id, campaign_name, product_id, source, products (name)",
      )
      .eq("store_id", store.id)
      .gte("expense_date", range.startDate)
      .lte("expense_date", range.endDate)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.rpc("get_expense_totals", { p_store_id: store.id, p_from: range.startDate, p_to: range.endDate }),
    supabase.from("products").select("id, name").eq("store_id", store.id).neq("status", "archived").order("name"),
    supabase.from("store_settings").select("ad_currency, usd_rate, apply_igv").eq("store_id", store.id).single(),
  ]);
  const defaults: AdDefaults = {
    currency: settings?.ad_currency === "USD" ? "USD" : "PEN",
    usdRate: Number(settings?.usd_rate ?? 3.75),
    applyIgv: Boolean(settings?.apply_igv),
  };

  const t = (totals ?? {}) as { ad_spend?: number; meta_spend?: number; igv?: number; other_expenses?: number; reference_only?: number };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Gastos"
        description="Registra tu gasto publicitario y otros gastos para calcular tu CPA real, ROAS real y utilidad."
        actions={
          <>
            <ImportMetaDialog products={products ?? []} defaults={defaults} />
            <ExpenseDialog products={products ?? []} defaults={defaults} />
          </>
        }
      />
      <DateRangeFilter basePath="/dashboard/gastos" range={range} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <p className="text-xs text-muted-foreground">Gasto publicitario</p>
          <p className="text-2xl font-semibold">{formatMoney(t.ad_spend ?? 0)}</p>
          <p className="text-xs text-muted-foreground">
            Meta: {formatMoney(t.meta_spend ?? 0)}
            {Number(t.igv ?? 0) > 0 ? ` · incluye IGV ${formatMoney(t.igv)}` : ""}
          </p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Otros gastos</p>
          <p className="text-2xl font-semibold">{formatMoney(t.other_expenses ?? 0)}</p>
          <p className="text-xs text-muted-foreground">Se restan en la utilidad</p>
        </div>
        <div className="col-span-2 rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Solo referencia de caja</p>
          <p className="text-2xl font-semibold">{formatMoney(t.reference_only ?? 0)}</p>
          <p className="text-xs text-muted-foreground">
            Producto, courier y envíos: su costo ya se toma de cada pedido entregado/enviado, por eso no se resta dos veces.
          </p>
        </div>
      </div>

      {!expenses?.length ? (
        <EmptyState
          icon={Receipt}
          title="Sin gastos en este periodo"
          description="Registra tu gasto en Meta Ads a mano o importa el reporte del Administrador de anuncios."
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="hidden md:table-cell">Detalle</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((e) => {
                const product = e.products as unknown as { name: string } | { name: string }[] | null;
                const productName = Array.isArray(product) ? product[0]?.name : product?.name;
                return (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{e.expense_date}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {EXPENSE_CATEGORIES[e.category as ExpenseCategory]}
                        {REFERENCE_ONLY_CATEGORIES.includes(e.category as ExpenseCategory) ? <SimpleBadge>Referencia</SimpleBadge> : null}
                        {e.source === "import" ? <SimpleBadge tone="info">Importado</SimpleBadge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-72 md:table-cell">
                      <div className="flex flex-col text-sm">
                        {e.description ? <span className="truncate">{e.description}</span> : null}
                        {e.campaign_id || e.campaign_name ? (
                          <span className="truncate text-xs text-muted-foreground">Campaña: {e.campaign_name ?? e.campaign_id}</span>
                        ) : null}
                        {productName ? <span className="text-xs text-muted-foreground">Producto: {productName}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(e.amount_pen)}
                      {e.currency === "USD" || Number(e.igv_rate) > 0 ? (
                        <span className="block text-xs text-muted-foreground">
                          {e.currency === "USD" ? `US$ ${Number(e.amount).toFixed(2)} × ${Number(e.exchange_rate)}` : formatMoney(e.amount)}
                          {Number(e.igv_rate) > 0 ? " + IGV" : ""}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <ExpenseDialog
                          products={products ?? []}
                          defaults={defaults}
                          expense={{
                            id: e.id,
                            expense_date: e.expense_date,
                            category: e.category,
                            description: e.description ?? "",
                            amount: Number(e.amount),
                            campaign_id: e.campaign_id ?? "",
                            campaign_name: e.campaign_name ?? "",
                            product_id: e.product_id ?? "",
                            currency: e.currency === "USD" ? "USD" : "PEN",
                            exchange_rate: Number(e.exchange_rate),
                            igv_rate: Number(e.igv_rate),
                          }}
                        />
                        <DeleteExpenseButton id={e.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
