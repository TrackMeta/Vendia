import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildTikTokEvent, hashPhoneE164, submitEventId, TIKTOK_URL_TEMPLATE } from "./events";

describe("TikTok Events API", () => {
  it("el teléfono va en E.164 con + y en SHA-256", () => {
    expect(hashPhoneE164("51987654321")).toBe(createHash("sha256").update("+51987654321").digest("hex"));
    expect(hashPhoneE164("12")).toBeUndefined();
  });

  it("arma el evento con el mismo id que el Pixel (deduplica)", () => {
    const e = buildTikTokEvent({
      event: "SubmitForm",
      eventId: submitEventId("abc"),
      eventTime: new Date("2026-10-08T15:00:00Z"),
      phone: "51987654321",
      ttclid: "E.C.P.xyz",
      value: 129.904,
      productId: "p1",
      productName: "Faja",
      quantity: 2,
      orderNumber: 1002,
    });
    expect(e).toMatchObject({ event: "SubmitForm", event_id: "lead_abc", event_time: 1791471600, properties: { currency: "PEN", value: 129.9, order_id: "1002" } });
    expect(e.user.ttclid).toBe("E.C.P.xyz");
    expect(e.user).not.toHaveProperty("ip");
  });

  it("la plantilla de URL usa los macros de TikTok y los mismos parámetros que Meta", () => {
    expect(TIKTOK_URL_TEMPLATE).toContain("campaign_id=__CAMPAIGN_ID__");
    expect(TIKTOK_URL_TEMPLATE).toContain("ad_id=__CID__");
  });
});
