package pe.vendia.app;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

// Lo que la app web le pide al celular: datos del APK, color de las barras, abrir WhatsApp/llamadas/mapas,
// guardar o compartir archivos (PDF, Excel, etiquetas) e imprimir la página.
@CapacitorPlugin(
    name = "VendiaNativo",
    // Solo Android 9 o menos pide permiso para escribir en Descargas (desde Android 10 no hace falta)
    permissions = { @Permission(alias = "descargas", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) }
)
public class VendiaNativoPlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        boolean firebase = false;
        try {
            // Por reflexión: Firebase llega con el plugin de avisos y no está en el classpath de la app.
            Class<?> fb = Class.forName("com.google.firebase.FirebaseApp");
            Object apps = fb.getMethod("getApps", Context.class).invoke(null, getContext());
            firebase = apps instanceof java.util.List && !((java.util.List<?>) apps).isEmpty();
        } catch (Throwable t) {
            firebase = false;
        }
        r.put("firebase", firebase);
        r.put("version", BuildConfig.VERSION_NAME);
        r.put("build", BuildConfig.VERSION_CODE);
        call.resolve(r);
    }

    // Barras del celular (arriba: hora/señal; abajo: navegación). Con Android 15 la app va de borde a borde y
    // el color de la barra ya no se puede pintar: lo que se ve detrás es el fondo de la ventana. Se pinta ese
    // fondo del color de la cabecera y se eligen íconos claros u oscuros según el tema.
    @PluginMethod
    public void barras(PluginCall call) {
        final String color = call.getString("color", "#FFFFFF");
        final boolean claro = Boolean.TRUE.equals(call.getBoolean("claro", false));
        getActivity().runOnUiThread(() -> {
            try {
                android.view.Window w = getActivity().getWindow();
                int c = android.graphics.Color.parseColor(color);
                w.getDecorView().setBackgroundColor(c);
                w.setStatusBarColor(c);
                w.setNavigationBarColor(c);
                androidx.core.view.WindowInsetsControllerCompat ic = androidx.core.view.WindowCompat.getInsetsController(w, w.getDecorView());
                ic.setAppearanceLightStatusBars(claro);
                ic.setAppearanceLightNavigationBars(claro);
                call.resolve();
            } catch (Throwable t) {
                call.reject(mensaje(t));
            }
        });
    }

    // Abre afuera de la app: WhatsApp (https://wa.me/...), llamadas (tel:), mapas, o cualquier página.
    @PluginMethod
    public void abrirExterno(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Falta la dirección para abrir");
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No hay una app en el celular para abrir esto");
        } catch (Throwable t) {
            call.reject(mensaje(t));
        }
    }

    // Guarda el archivo en la carpeta Descargas del celular.
    @PluginMethod
    public void guardarArchivo(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("descargas") != PermissionState.GRANTED) {
            requestPermissionForAlias("descargas", call, "permisoDescargas");
            return;
        }
        guardar(call);
    }

    @PermissionCallback
    private void permisoDescargas(PluginCall call) {
        if (getPermissionState("descargas") == PermissionState.GRANTED) {
            guardar(call);
        } else {
            call.reject("Sin permiso para guardar en Descargas");
        }
    }

    private void guardar(PluginCall call) {
        try {
            byte[] datos = decodificar(call.getString("base64"));
            String nombre = limpiarNombre(call.getString("nombre"));
            String mime = tipo(call.getString("mime"));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, nombre);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IllegalStateException("No se pudo crear el archivo en Descargas");
                try (OutputStream os = cr.openOutputStream(uri)) {
                    if (os == null) throw new IllegalStateException("No se pudo escribir el archivo");
                    os.write(datos);
                }
                ContentValues listo = new ContentValues();
                listo.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, listo, null, null);
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("No se pudo abrir Descargas");
                File f = libre(dir, nombre);
                try (FileOutputStream fos = new FileOutputStream(f)) {
                    fos.write(datos);
                }
                nombre = f.getName();
                // Para que aparezca enseguida en la app de archivos
                MediaScannerConnection.scanFile(getContext(), new String[] { f.getAbsolutePath() }, new String[] { mime }, null);
            }
            JSObject r = new JSObject();
            r.put("ok", true);
            r.put("nombre", nombre);
            call.resolve(r);
        } catch (Throwable t) {
            call.reject(mensaje(t));
        }
    }

    // Comparte el archivo (WhatsApp, correo, Drive…) con la ventana de Android.
    @PluginMethod
    public void compartirArchivo(PluginCall call) {
        try {
            byte[] datos = decodificar(call.getString("base64"));
            String nombre = limpiarNombre(call.getString("nombre"));
            String mime = tipo(call.getString("mime"));
            File dir = new File(getContext().getCacheDir(), "compartir");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("No se pudo preparar el archivo");
            File f = new File(dir, nombre);
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(datos);
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent enviar = new Intent(Intent.ACTION_SEND);
            enviar.setType(mime);
            enviar.putExtra(Intent.EXTRA_STREAM, uri);
            enviar.setClipData(ClipData.newRawUri(nombre, uri));
            enviar.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent elegir = Intent.createChooser(enviar, "Compartir");
            elegir.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(elegir);
            call.resolve();
        } catch (Throwable t) {
            call.reject(mensaje(t));
        }
    }

    // Imprime la página que se ve (la ventana de Android deja «Guardar como PDF»).
    @PluginMethod
    public void imprimir(PluginCall call) {
        String t = call.getString("titulo");
        final String titulo = (t == null || t.trim().isEmpty()) ? "Vendia" : t.trim();
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (pm == null) throw new IllegalStateException("Este celular no permite imprimir");
                WebView wv = getBridge().getWebView();
                PrintDocumentAdapter adaptador = wv.createPrintDocumentAdapter(titulo);
                pm.print(titulo, adaptador, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Throwable e) {
                call.reject(mensaje(e));
            }
        });
    }

    // Acepta base64 puro o «data:...;base64,....»
    private static byte[] decodificar(String b64) {
        if (b64 == null || b64.isEmpty()) throw new IllegalArgumentException("Falta el archivo");
        int coma = b64.indexOf(',');
        if (b64.startsWith("data:") && coma >= 0) b64 = b64.substring(coma + 1);
        return Base64.decode(b64, Base64.DEFAULT);
    }

    // Sin carpetas ni caracteres raros en el nombre
    private static String limpiarNombre(String nombre) {
        String n = nombre == null ? "" : nombre.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        if (n.isEmpty()) n = "archivo";
        if (n.length() > 120) n = n.substring(n.length() - 120);
        return n;
    }

    private static String tipo(String mime) {
        return (mime == null || mime.trim().isEmpty()) ? "application/octet-stream" : mime.trim();
    }

    // Si ya existe «x.pdf», usa «x (1).pdf», «x (2).pdf»…
    private static File libre(File dir, String nombre) {
        File f = new File(dir, nombre);
        if (!f.exists()) return f;
        int punto = nombre.lastIndexOf('.');
        String base = punto > 0 ? nombre.substring(0, punto) : nombre;
        String ext = punto > 0 ? nombre.substring(punto) : "";
        for (int i = 1; i < 1000; i++) {
            f = new File(dir, base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
        return f;
    }

    private static String mensaje(Throwable t) {
        return t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName();
    }
}
