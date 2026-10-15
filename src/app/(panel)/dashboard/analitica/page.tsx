import { redirect } from "next/navigation";

/** Analítica se unió a Rendimiento (pestañas Embudo y Zonas). Los enlaces antiguos siguen funcionando. */
export default async function AnalyticsRedirect({ searchParams }: PageProps<"/dashboard/analitica">) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const key of ["rango", "desde", "hasta", "padre", "nombre"]) {
    const v = sp[key];
    if (typeof v === "string") q.set(key, v);
  }
  if (sp.vista === "geografia") {
    q.set("vista", "zonas");
    if (sp.nivel === "province" || sp.nivel === "district") q.set("geo", sp.nivel);
  } else if (sp.vista === "campanas" || sp.vista === "productos") {
    q.set("nivel", sp.vista);
  } else {
    q.set("vista", "embudo");
  }
  redirect(`/dashboard/rendimiento?${q.toString()}`);
}
