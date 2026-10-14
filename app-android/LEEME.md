# APK de Vendia (Android)

Envoltorio [Capacitor](https://capacitorjs.com) que abre el panel de Vendia
(https://vendia-theta.vercel.app/dashboard) como una app del celular, con avisos, ícono y atajos propios.

- **La web se actualiza sola:** cada deploy de Vercel ya llega a la app, sin APK nuevo.
  **Solo hace falta un APK nuevo** si cambia algo de esta carpeta (permisos, ícono, sonidos, plugin nativo).
- **Descargar (siempre la última):** https://github.com/TrackMeta/Vendia/releases/latest/download/Vendia.apk
- **Armar:** GitHub → Actions → «APK de Vendia» → Run workflow (o cualquier push a `main` que toque `app-android/`).
  Queda publicado en *Releases* como `Vendia 1.0.N` (y también en *Artifacts* de esa corrida).
- **Secretos de GitHub** (Settings → Secrets and variables → Actions), todos opcionales:
  - `GOOGLE_SERVICES_JSON`: el archivo `google-services.json` de Firebase (avisos con la app cerrada).
  - `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASS` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASS`: la firma.
    Sin la firma sale un APK de prueba que, para actualizar, hay que desinstalar el anterior.
- **Secreto de Vercel:** `FCM_SERVICE_ACCOUNT` (cuenta de servicio de Firebase) para que el servidor mande los avisos.
- **La llave de firma** nunca va al repo (es público): vive en `D:\Vendia\.llaves-app\` de la compu de Rodrigo
  (ignorada por git). Si se pierde, los celulares tendrán que desinstalar y volver a instalar.
- **Plugin nativo `VendiaNativo`:** `info`, `barras`, `abrirExterno` (WhatsApp, llamadas, mapas), `guardarArchivo`
  (Descargas), `compartirArchivo` e `imprimir` (deja «Guardar como PDF»).
- **Atajos del ícono:** «Nuevo pedido» y «Por confirmar». Los enlaces `https://vendia-theta.vercel.app/dashboard/...`
  también se pueden abrir con la app.
- **Sonidos de los avisos** (`res/raw`): `dingdong`, `caja`, `moneda`, `campana` (canales `vendia_*`;
  `vendia_silencio` no suena). Se generan con `node app-android/tools-sonidos.mjs` (mismas notas que la web).
- **Íconos:** `node app-android/tools-iconos.mjs` (desde `D:\Vendia`, usa `Recursos Iconos/Logo sin Fondo.png`).
