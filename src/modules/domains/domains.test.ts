import { describe, expect, it } from "vitest";
import {
  checkDns,
  dnsInstructions,
  dnsRecords,
  hasVerifyTxt,
  isApex,
  isAppHost,
  isPassthroughPath,
  isValidDomain,
  isVercelCname,
  normalizeDomain,
  recordName,
  registrableDomain,
  rewriteForDomain,
  verifyHost,
  verifyValue,
  wwwCompanion,
} from "./index";

describe("Dominios propios", () => {
  it("normaliza y valida lo que escribe el usuario", () => {
    expect(normalizeDomain(" https://WWW.MiTienda.pe/landing ")).toBe("www.mitienda.pe");
    expect(normalizeDomain("http://tienda.pe:8080/")).toBe("tienda.pe");
    expect(normalizeDomain("tienda.pe.")).toBe("tienda.pe");
    expect(isValidDomain("www.mitienda.pe")).toBe(true);
    expect(isValidDomain("mitienda")).toBe(false);
    expect(isValidDomain("mi_tienda.pe")).toBe(false);
  });

  it("dominio raíz → registro A; subdominio → CNAME (incluye .com.pe y .co.uk)", () => {
    expect(isApex("mitienda.pe")).toBe(true);
    expect(isApex("mitienda.com.pe")).toBe(true);
    expect(isApex("mitienda.co.uk")).toBe(true);
    expect(isApex("www.mitienda.com.pe")).toBe(false);
    expect(isApex("tienda.mitienda.pe")).toBe(false);
    expect(registrableDomain("a.b.midominio.com.pe")).toBe("midominio.com.pe");
    expect(registrableDomain("a.b.midominio.pe")).toBe("midominio.pe");
    expect(dnsInstructions("mitienda.pe")).toEqual({ type: "A", name: "@", value: "76.76.21.21" });
    expect(dnsInstructions("tienda.midominio.pe")).toEqual({ type: "CNAME", name: "tienda", value: "cname.vercel-dns.com" });
  });

  it("subdominios profundos usan el nombre completo relativo al dominio comprado", () => {
    expect(recordName("a.b.midominio.pe")).toBe("a.b");
    expect(recordName("a.b.midominio.com.pe")).toBe("a.b");
    expect(recordName("midominio.pe")).toBe("@");
    expect(dnsInstructions("a.b.midominio.pe").name).toBe("a.b");
  });

  it("registro TXT de verificación", () => {
    expect(verifyHost("tienda.pe")).toBe("_vendia.tienda.pe");
    expect(verifyValue("abc123")).toBe("vendia-verify=abc123");
    expect(recordName(verifyHost("tienda.pe"))).toBe("_vendia");
    expect(recordName(verifyHost("a.b.tienda.com.pe"))).toBe("_vendia.a.b");
    expect(hasVerifyTxt([["otro"], ["vendia-verify=", "abc123"]], "abc123")).toBe(true);
    expect(hasVerifyTxt([["vendia-verify=zzz"]], "abc123")).toBe(false);
    expect(hasVerifyTxt([], "abc123")).toBe(false);
  });

  it("registros que se muestran: raíz con www y TXT; subdominio sin www", () => {
    expect(dnsRecords("tienda.pe", "tok")).toEqual([
      { type: "A", name: "@", value: "76.76.21.21" },
      { type: "CNAME", name: "www", value: "cname.vercel-dns.com" },
      { type: "TXT", name: "_vendia", value: "vendia-verify=tok" },
    ]);
    expect(dnsRecords("shop.tienda.pe", "tok")).toEqual([
      { type: "CNAME", name: "shop", value: "cname.vercel-dns.com" },
      { type: "TXT", name: "_vendia.shop", value: "vendia-verify=tok" },
    ]);
    expect(wwwCompanion("tienda.pe")).toBe("www.tienda.pe");
    expect(wwwCompanion("www.tienda.pe")).toBeNull();
  });

  it("revisa el DNS: todos los A de Vercel, sin AAAA; subdominio con CNAME o A", () => {
    const none = { cname: [], a: [], aaaa: [] };
    expect(checkDns("tienda.pe", { ...none, a: ["76.76.21.21"] }).ok).toBe(true);
    expect(checkDns("tienda.pe", { ...none, a: ["76.76.21.21", "1.2.3.4"] }).ok).toBe(false);
    expect(checkDns("tienda.pe", { ...none, a: ["76.76.21.21"], aaaa: ["2606:4700::1"] }).ok).toBe(false);
    expect(checkDns("tienda.pe", none).ok).toBe(false);
    expect(checkDns("shop.tienda.pe", { ...none, cname: ["cname.vercel-dns.com."] }).ok).toBe(true);
    expect(checkDns("shop.tienda.pe", { ...none, cname: ["abc.vercel-dns-017.com"] }).ok).toBe(true);
    expect(checkDns("shop.tienda.pe", { ...none, a: ["76.76.21.21"] }).ok).toBe(true);
    expect(checkDns("shop.tienda.pe", { ...none, cname: ["otro.host.com"] }).ok).toBe(false);
    expect(isVercelCname("cname.vercel-dns.com")).toBe(true);
    expect(isVercelCname("vercel-dns.com.evil.pe")).toBe(false);
  });

  it("el panel de Vendia no se reescribe", () => {
    expect(isAppHost("vendia-abc.vercel.app", "https://vendia.pe")).toBe(true);
    expect(isAppHost("localhost:3000", undefined)).toBe(true);
    expect(isAppHost("vendia.pe", "https://vendia.pe")).toBe(true);
    expect(isAppHost("mitienda.pe", "https://vendia.pe")).toBe(false);
    expect(isPassthroughPath("/api/orders")).toBe(true);
    expect(isPassthroughPath("/ubigeo-pe.json")).toBe(true);
    expect(isPassthroughPath("/manifest.webmanifest")).toBe(true);
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

  it("la raíz muestra la landing principal", () => {
    const root = { storeSlug: "fajas", landingSlug: "faja" };
    expect(rewriteForDomain("/", { storeSlug: "fajas", allStores: false, root })).toEqual({ path: "/p/fajas/faja", storeSlug: "fajas", root: true });
    expect(rewriteForDomain("/", { storeSlug: null, allStores: true, root })).toEqual({ path: "/p/fajas/faja", storeSlug: "fajas", root: true });
    expect(rewriteForDomain("/", { storeSlug: null, allStores: true, root: null })).toBeNull();
  });
});
