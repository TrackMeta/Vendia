"use client";

import { Printer } from "lucide-react";
import { printPage } from "@/modules/app-native/files";

export function PrintButton() {
  return (
    <button type="button" onClick={() => printPage("Rótulos")} className="ml-auto flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">
      <Printer className="size-4" /> Imprimir
    </button>
  );
}
