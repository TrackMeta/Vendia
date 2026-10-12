// Uso: node scripts/sqlfn.mjs nombre_funcion [...] — imprime la última definición de cada función SQL
import fs from "node:fs";
import path from "node:path";
const dir = path.join(import.meta.dirname, "../supabase/migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
for (const name of process.argv.slice(2)) {
  let found = null;
  for (const f of files) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    let i = -1;
    const needle = `function public.${name}(`;
    const isDef = (j) => /create (or replace )?$/.test(s.slice(s.lastIndexOf("\n", j) + 1, j));
    while ((i = s.indexOf(needle, i + 1)) !== -1) {
      if (!isDef(i)) continue;
      const start = s.lastIndexOf("\n", i) + 1;
      const end = s.indexOf("\n$$;", i);
      found = { f, text: s.slice(start, end + 4) };
    }
  }
  console.log(`=== ${name} @ ${found ? found.f : "NO ENCONTRADA"}\n${found ? found.text : ""}\n`);
}
