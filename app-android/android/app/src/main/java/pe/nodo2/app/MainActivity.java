package pe.nodo2.app;

import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewGroup.MarginLayoutParams;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    // Pantalla de inicio animada: la V aparece con un rebote, late mientras carga y, cuando la app ya se ve
    // (la web avisa con VendiaNativo.listo()), crece y se abre hacia la app.
    private static final long REBOTE_MS = 650;
    private static final long TOPE_MS = 12000;
    private final Handler principal = new Handler(Looper.getMainLooper());
    private FrameLayout inicio;
    private ImageView inicioV;
    private ObjectAnimator latido;
    private boolean inicioCerrando = false;
    private long inicioDesde;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin propio (VendiaNativo): versión del APK, Firebase, barras, archivos, imprimir. Va antes de super.onCreate.
        registerPlugin(VendiaNativoPlugin.class);
        super.onCreate(savedInstanceState);
        // Teclado: Capacitor deja márgenes para las barras del sistema (adjustMarginsForEdgeToEdge) pero no para el
        // teclado, y con Android 15 el teclado tapaba los campos de abajo. Mismo cálculo + el teclado:
        // abajo se deja lo que sea más alto, la barra de navegación o el teclado, y la página se achica por encima.
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv != null) {
            ViewCompat.setOnApplyWindowInsetsListener(wv, (v, wi) -> {
                Insets bars = wi.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                Insets ime = wi.getInsets(WindowInsetsCompat.Type.ime());
                MarginLayoutParams mlp = (MarginLayoutParams) v.getLayoutParams();
                mlp.leftMargin = bars.left;
                mlp.rightMargin = bars.right;
                mlp.topMargin = bars.top;
                mlp.bottomMargin = Math.max(bars.bottom, ime.bottom);
                v.setLayoutParams(mlp);
                return WindowInsetsCompat.CONSUMED;
            });
        }
        // Al girar el celular o si Android recrea la pantalla, no se repite
        if (savedInstanceState == null) mostrarInicio();
        // Respaldo: si la web no avisa (sin internet, página de error), se cierra poco después de cargar
        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    principal.postDelayed(MainActivity.this::ocultarInicio, 4000);
                }

                @Override
                public void onReceivedError(WebView webView) {
                    principal.postDelayed(MainActivity.this::ocultarInicio, 1500);
                }
            });
        }
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void mostrarInicio() {
        inicio = new FrameLayout(this);
        inicio.setBackgroundColor(Color.WHITE);
        inicio.setClickable(true); // nada se toca por debajo mientras carga

        inicioV = new ImageView(this);
        inicioV.setImageResource(R.drawable.inicio_v);
        inicioV.setAdjustViewBounds(true);
        inicio.addView(inicioV, new FrameLayout.LayoutParams(dp(104), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        TextView nombre = new TextView(this);
        nombre.setText("Vendia");
        nombre.setTextColor(Color.parseColor("#202124"));
        nombre.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        nombre.setTypeface(Typeface.DEFAULT_BOLD);
        nombre.setAlpha(0f);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER_HORIZONTAL | Gravity.BOTTOM
        );
        lp.bottomMargin = dp(64);
        inicio.addView(nombre, lp);

        ((ViewGroup) getWindow().getDecorView()).addView(
            inicio,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        inicioDesde = SystemClock.uptimeMillis();
        // Hora y batería en gris oscuro sobre el blanco (después la web pinta la barra como su cabecera)
        androidx.core.view.WindowInsetsControllerCompat barras = androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        barras.setAppearanceLightStatusBars(true);
        barras.setAppearanceLightNavigationBars(true);

        // 1) Rebote: entra chica y transparente, se pasa un poquito y se acomoda
        inicioV.setScaleX(0.3f);
        inicioV.setScaleY(0.3f);
        inicioV.setAlpha(0f);
        inicioV
            .animate()
            .scaleX(1f)
            .scaleY(1f)
            .alpha(1f)
            .setDuration(REBOTE_MS)
            .setInterpolator(new OvershootInterpolator(2.6f))
            .withEndAction(this::latir)
            .start();
        nombre.animate().alpha(1f).setStartDelay(450).setDuration(350).start();
        // Tope: nunca se queda pegada
        principal.postDelayed(this::ocultarInicio, TOPE_MS);
    }

    // 2) Late suave mientras la app termina de cargar
    private void latir() {
        if (inicioCerrando || inicioV == null) return;
        latido = ObjectAnimator.ofPropertyValuesHolder(
            inicioV,
            PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.08f),
            PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.08f)
        );
        latido.setDuration(550);
        latido.setRepeatCount(ValueAnimator.INFINITE);
        latido.setRepeatMode(ValueAnimator.REVERSE);
        latido.setInterpolator(new AccelerateDecelerateInterpolator());
        latido.start();
    }

    // 3) La app ya se ve: la V crece y la pantalla blanca se desvanece hacia la app
    public void ocultarInicio() {
        runOnUiThread(() -> {
            if (inicio == null || inicioCerrando) return;
            long falta = REBOTE_MS + 250 - (SystemClock.uptimeMillis() - inicioDesde);
            if (falta > 0) {
                // Que el rebote se vea completo aunque la app cargue al toque
                principal.postDelayed(this::ocultarInicio, falta);
                return;
            }
            inicioCerrando = true;
            principal.removeCallbacksAndMessages(null);
            if (latido != null) latido.cancel();
            final FrameLayout capa = inicio;
            inicioV.animate().scaleX(5f).scaleY(5f).setDuration(420).setInterpolator(new AccelerateInterpolator()).start();
            capa
                .animate()
                .alpha(0f)
                .setDuration(420)
                .withEndAction(() -> {
                    ViewGroup padre = (ViewGroup) capa.getParent();
                    if (padre != null) padre.removeView(capa);
                    inicio = null;
                    inicioV = null;
                })
                .start();
        });
    }
}
