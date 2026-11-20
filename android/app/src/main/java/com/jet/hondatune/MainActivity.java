package com.jet.hondatune;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import java.util.ArrayList;

public class MainActivity extends Activity {
    static final int REQ_FILE = 11;
    static final int REQ_PERM = 12;

    WebView web;
    JetBridge bridge;
    ValueCallback<Uri[]> fileCb;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(Color.BLACK);
        w.setNavigationBarColor(Color.BLACK);
        immersive();

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#04060B"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setGeolocationEnabled(true);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                // phone GPS for DRAG LOG (only used when the Smart Gauge has no GPS)
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERM);
                cb.invoke(origin, true, false);
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "เลือกไฟล์"), REQ_FILE);
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });

        bridge = new JetBridge(this, web);
        web.addJavascriptInterface(bridge, "JetNative");
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        askPermissions();
    }

    void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    void askPermissions() {
        ArrayList<String> need = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            need.add(Manifest.permission.BLUETOOTH_SCAN);
            need.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        need.add(Manifest.permission.ACCESS_FINE_LOCATION);
        need.add(Manifest.permission.ACCESS_COARSE_LOCATION);   // Android 12+ ignores FINE alone
        if (Build.VERSION.SDK_INT <= 28) need.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        ArrayList<String> miss = new ArrayList<>();
        for (String p : need) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) miss.add(p);
        if (!miss.isEmpty()) requestPermissions(miss.toArray(new String[0]), REQ_PERM);
    }

    boolean hasBlePermission() {
        if (Build.VERSION.SDK_INT >= 31)
            return checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCb == null) return;
        Uri[] res = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData cd = data.getClipData();
            if (cd != null) {
                res = new Uri[cd.getItemCount()];
                for (int i = 0; i < cd.getItemCount(); i++) res[i] = cd.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                res = new Uri[]{data.getData()};
            }
        }
        fileCb.onReceiveValue(res);
        fileCb = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // USB device attached while the app is open -> tell the page
        if (intent != null && "android.hardware.usb.action.USB_DEVICE_ATTACHED".equals(intent.getAction()))
            bridge.emit("usb-attached", "{}");
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.JetBack?JetBack():false", v -> {
            if (!"true".equals(v)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() {
        bridge.closeAll();
        web.destroy();
        super.onDestroy();
    }

    /** screen rotation chosen in Setup: "land" / "port" pin the orientation, anything else follows the sensor (all four directions) */
    void setOrient(String mode) {
        final int o = "land".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : "port".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                : ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR;
        runOnUiThread(() -> setRequestedOrientation(o));
    }

    void keepScreen(boolean on) {
        runOnUiThread(() -> {
            if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }
}
