import { describe, expect, it } from "vitest";
import { channelForNotification, PUSH_CHANNELS, PUSH_SILENT_CHANNEL } from "./channels";

describe("canal del aviso en el celular", () => {
  const base = { sound: "caja", sound_enabled: true, only_orders: false };

  it("usa el sonido que eligió la persona", () => {
    expect(channelForNotification(base, "new_order")).toBe("vendia_caja");
    expect(channelForNotification(base, "risky_customer")).toBe("vendia_caja");
  });

  it("sin sonido si lo apagó", () => {
    expect(channelForNotification({ ...base, sound_enabled: false }, "new_order")).toBe(PUSH_SILENT_CHANNEL);
  });

  it("«solo pedidos nuevos»: lo demás llega sin sonido", () => {
    const d = { ...base, only_orders: true };
    expect(channelForNotification(d, "new_order")).toBe("vendia_caja");
    expect(channelForNotification(d, "team")).toBe(PUSH_SILENT_CHANNEL);
  });

  it("un sonido desconocido vuelve a ding-dong", () => {
    expect(channelForNotification({ ...base, sound: "raro" }, "new_order")).toBe("vendia_dingdong");
  });

  it("la app crea un canal por sonido y uno mudo", () => {
    expect(PUSH_CHANNELS.map((c) => c.id)).toEqual(["vendia_dingdong", "vendia_caja", "vendia_moneda", "vendia_campana", "vendia_silencio"]);
  });
});
