"use client";

import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";
import { AD_CATEGORIES, type AdCurrency, EXPENSE_CATEGORIES, type ExpenseCategory, IGV_RATE, toPen } from "@/modules/expenses/categories";
import { type ImportResult, parseMetaAdsCsv } from "@/modules/expenses/import-meta";
import { limaToday } from "@/modules/metrics/date-range";
import { deleteExpense, importMetaExpenses, saveExpense } from "./actions";

type Product = { id: string; name: string };
type ExpenseValues = {
  id: string;
  expense_date: string;
  category: string;
  description: string;
  amount: number;
  campaign_id: string;
  campaign_name: string;
  product_id: string;
  currency: AdCurrency;
  exchange_rate: number;
  igv_rate: number;
};

/** Valores sugeridos de la tienda: moneda de la cuenta publicitaria, tipo de cambio e IGV. */
export type AdDefaults = { currency: AdCurrency; usdRate: number; applyIgv: boolean };

const select = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function ExpenseDialog({ products, expense, defaults }: { products: Product[]; expense?: ExpenseValues; defaults: AdDefaults }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>(expense?.category ?? "meta_ads");
  const isAd = AD_CATEGORIES.includes(category as ExpenseCategory);
  const [currency, setCurrency] = useState<AdCurrency>(expense?.currency ?? defaults.currency);
  const [rate, setRate] = useState<number>(expense ? expense.exchange_rate : defaults.usdRate);
  const [igv, setIgv] = useState<boolean>(expense ? expense.igv_rate > 0 : defaults.applyIgv);
  const [amount, setAmount] = useState<string>(expense ? String(expense.amount) : "");
  const usd = isAd && currency === "USD";
  const pen = toPen(Number(amount) || 0, usd ? rate : 1, isAd && igv ? IGV_RATE : 0);
  const [, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof saveExpense>> | undefined, formData: FormData) => {
    const result = await saveExpense(expense?.id ?? null, prev, formData);
    if (result.ok) {
      toast.success(result.message ?? "Guardado");
      setOpen(false);
    } else toast.error(result.error);
    return result;
  }, undefined);

  return (
    <>
      {expense ? (
        <Button size="icon-sm" variant="ghost" onClick={() => setOpen(true)} aria-label="Editar gasto">
          <Pencil />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus /> Registrar gasto
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{expense ? "Editar gasto" : "Registrar gasto"}</DialogTitle>
            <DialogDescription>Todo se convierte a soles para tus métricas. El tipo de cambio queda guardado en el gasto.</DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="expense_date">Fecha</Label>
              <Input id="expense_date" name="expense_date" type="date" required defaultValue={expense?.expense_date ?? limaToday()} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="category">Categoría</Label>
              <select id="category" name="category" required value={category} onChange={(e) => setCategory(e.target.value)} className={select}>
                {Object.entries(EXPENSE_CATEGORIES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="amount">Monto ({usd ? "US$" : "S/"})</Label>
              <div className="flex gap-1.5">
                {isAd ? (
                  <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value as AdCurrency)} className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm" aria-label="Moneda">
                    <option value="PEN">S/</option>
                    <option value="USD">US$</option>
                  </select>
                ) : (
                  <input type="hidden" name="currency" value="PEN" />
                )}
                <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>
            {usd ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="exchange_rate">Tipo de cambio (S/ por US$)</Label>
                <Input id="exchange_rate" name="exchange_rate" type="number" step="0.0001" min="1" required value={rate} onChange={(e) => setRate(Number(e.target.value) || 0)} />
              </div>
            ) : (
              <input type="hidden" name="exchange_rate" value="1" />
            )}
            {isAd ? (
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" name="igv" checked={igv} onChange={(e) => setIgv(e.target.checked)} className="size-4" />
                Sumar IGV 18 %
              </label>
            ) : null}
            {isAd && (usd || igv) ? (
              <p className="rounded-md bg-muted/50 p-2 text-sm sm:col-span-2">
                En soles: <b>{formatMoney(pen)}</b>
                {usd ? ` (US$ ${(Number(amount) || 0).toFixed(2)} × ${rate})` : ""}
                {igv ? " + IGV" : ""}
              </p>
            ) : null}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="description">Descripción (opcional)</Label>
              <Input id="description" name="description" defaultValue={expense?.description} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="campaign_id">ID de campaña (opcional)</Label>
              <Input id="campaign_id" name="campaign_id" defaultValue={expense?.campaign_id} placeholder="120200..." />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="campaign_name">Nombre de campaña (opcional)</Label>
              <Input id="campaign_name" name="campaign_name" defaultValue={expense?.campaign_name} />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="product_id">Producto (opcional)</Label>
              <select id="product_id" name="product_id" defaultValue={expense?.product_id ?? ""} className={select}>
                <option value="">—</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Con el ID de campaña y el producto, Vendia calcula el CPA y la utilidad por campaña y por producto.
              </p>
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteExpenseButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      disabled={pending}
      aria-label="Eliminar gasto"
      onClick={() => {
        if (!confirm("¿Eliminar este gasto?")) return;
        startTransition(async () => {
          const r = await deleteExpense(id);
          if (r.ok) toast.success(r.message ?? "Eliminado");
          else toast.error(r.error);
        });
      }}
    >
      <Trash2 />
    </Button>
  );
}

export function ImportMetaDialog({ products, defaults }: { products: Product[]; defaults: AdDefaults }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [productId, setProductId] = useState("");
  const [pending, startTransition] = useTransition();
  const total = result?.rows.reduce((s, r) => s + r.amount, 0) ?? 0;
  const usd = defaults.currency === "USD";
  const totalPen = toPen(total, usd ? defaults.usdRate : 1, defaults.applyIgv ? IGV_RATE : 0);
  const money = (v: number) => (usd ? `US$ ${v.toFixed(2)}` : formatMoney(v));

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload /> Importar de Meta Ads
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setResult(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Importar gasto de Meta Ads</DialogTitle>
            <DialogDescription>
              En el Administrador de anuncios: nivel <b>Campañas</b> → Desglose → Por tiempo → <b>Día</b> → Exportar → CSV. Incluye las columnas
              «Identificador de la campaña» e «Importe gastado». Reimportar el mismo reporte no duplica el gasto.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) {
                  toast.error("El archivo pesa más de 5 MB");
                  return;
                }
                setResult(parseMetaAdsCsv(await file.text()));
              }}
            />
            {result ? (
              <div className="flex flex-col gap-2 text-sm">
                {result.errors.map((e) => (
                  <p key={e} className="rounded-md bg-destructive/10 p-2 text-destructive">
                    {e}
                  </p>
                ))}
                {result.warnings.slice(0, 5).map((w) => (
                  <p key={w} className="rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    {w}
                  </p>
                ))}
                {result.rows.length ? (
                  <>
                    <p>
                      <b>{result.rows.length}</b> filas · total <b>{money(total)}</b> · del {result.rows[0].date} al {result.rows.at(-1)?.date}
                    </p>
                    {usd || defaults.applyIgv ? (
                      <p className="text-xs text-muted-foreground">
                        Se guardará como {formatMoney(totalPen)}
                        {usd ? ` (tipo de cambio ${defaults.usdRate})` : ""}
                        {defaults.applyIgv ? " con IGV 18 %" : ""}. Lo cambias en Configuración → Gasto publicitario.
                      </p>
                    ) : null}
                    <div className="max-h-48 overflow-auto rounded-md border">
                      <table className="w-full text-xs">
                        <tbody>
                          {result.rows.slice(0, 50).map((r) => (
                            <tr key={r.importKey} className="border-b last:border-0">
                              <td className="p-1.5">{r.date}</td>
                              <td className="p-1.5">{r.campaignName ?? r.campaignId}</td>
                              <td className="p-1.5 text-right">{money(r.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Asignar a un producto (opcional)</Label>
                      <select value={productId} onChange={(e) => setProductId(e.target.value)} className={select}>
                        <option value="">—</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const r = await importMetaExpenses({ rows: result.rows, productId });
                          if (r.ok) {
                            toast.success(r.message ?? "Importado");
                            setOpen(false);
                            setResult(null);
                          } else toast.error(r.error);
                        })
                      }
                    >
                      {pending ? "Importando…" : `Importar ${formatMoney(totalPen)}`}
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
