import { describe, expect, it } from "vitest";
import { dnsInstructions, isApex, isAppHost, isPassthroughPath, isValidDomain, normalizeDomain, rewriteForDomain } from "./index";

describe("Dominios propios", () => {
  it("normaliza y valida lo que escribe el usuario", () => {
    expect(normalizeDomain(" https://WWW.MiTienda.pe/landing ")).toBe("www.mitienda.pe");
    expect(isValidDomain("www.mitienda.pe")).toBe(true);
    expect(isValidDomain("mitienda")).toBe(false);
    expect(isValidDomain("mi_tienda.pe")).toBe(false);
  });

  it("dominio raíz → registro A; subdominio → CNAME (incluye .com.pe)", () => {
    expect(isApex("mitienda.pe")).toBe(true);
    expect(isApex("mitienda.com.pe")).toBe(true);
    expect(isApex("www.mitienda.com.pe")).toBe(false);
    expect(dnsInstructions("mitienda.pe")).toEqual({ type: "A", name: "@", value: "76.76.21.21" });
    expect(dnsInstructions("tienda.midominio.pe")).toEqual({ type: "CNAME", name: "tienda", value: "cname.vercel-dns.com" });
  });

  it("el panel de Vendia no se reescribe", () => {
    expect(isAppHost("vendia-abc.vercel.app", "https://vendia.pe")).toBe(true);
    expect(isAppHost("localhost:3000", undefined)).toBe(true);
    expect(isAppHost("vendia.pe", "https://vendia.pe")).toBe(true);
    expect(isAppHost("mitienda.pe", "https://vendia.pe")).toBe(false);
    expect(isPassthroughPath("/api/orders")).toBe(true);
    expect(isPassthroughPath("/ubigeo-pe.json")).toBe(true);
    expect(isPassthroughPath("/faja")).toBe(false);
  });

  it("reescribe las rutas de las landings", () => {
    expect(rewriteForDomain("/faja", { storeSlug: "fajas", allStores: false })).toEqual({ path: "/p/fajas/faja", storeSlug: "fajas" });
    expect(rewriteForDomain("/faja/gracias", { storeSlug: "fajas", allStores: false })?.path).toBe("/p/fajas/faja/gracias");
    expect(rewriteForDomain("/", { storeSlug: "fajas", allStores: false })).toBeNull();
    expect(rewriteForDomain("/fajas/faja", { storeSlug: null, allStores: true })).toEqual({ path: "/p/fajas/faja", storeSlug: "fajas" });
    expect(rewriteForDomain("/faja", { storeSlug: null, allStores: true })).toBeNull();
    expect(rewriteForDomain("/a/b/c", { storeSlug: null, allStores: true })).toBeNull();
  });
});
