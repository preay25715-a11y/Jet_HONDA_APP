package com.jet.hondatune;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.RouteInfo;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.ArrayAdapter;

import com.hoho.android.usbserial.driver.CdcAcmSerialDriver;
import com.hoho.android.usbserial.driver.ProbeTable;
import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;
import com.hoho.android.usbserial.util.SerialInputOutputManager;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * JS <-> Android bridge, exposed to the page as window.JetNative.
 * Events go back to the page through window.JetEvt(name, data).
 */
@SuppressLint("MissingPermission")
public class JetBridge {
    static final String ACTION_USB_PERM = "com.jet.hondatune.USB_PERMISSION";
    static final UUID NUS = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    static final UUID NUS_RX = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    static final UUID NUS_TX = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
    static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    final MainActivity act;
    final WebView web;
    final Handler ui = new Handler(Looper.getMainLooper());
    final UsbManager usbManager;

    // USB
    UsbSerialPort port;
    SerialInputOutputManager io;
    ExecutorService ioExec;
    int usbParity = UsbSerialPort.PARITY_NONE;

    // BLE
    BluetoothGatt gatt;
    BluetoothGattCharacteristic rxCh, txCh;
    BluetoothLeScanner scanner;
    ScanCallback scanCb;
    int mtu = 23;
    boolean bleReady = false, bleWriting = false;
    final ConcurrentLinkedDeque<byte[]> bleQ = new ConcurrentLinkedDeque<>();

    JetBridge(MainActivity a, WebView w) {
        act = a;
        web = w;
        usbManager = (UsbManager) a.getSystemService(Context.USB_SERVICE);
    }

    void emit(String evt, String jsonData) {
        final String js = "window.JetEvt&&JetEvt(" + JSONObject.quote(evt) + "," + jsonData + ")";
        ui.post(() -> web.evaluateJavascript(js, null));
    }

    static String q(String s) { return JSONObject.quote(s == null ? "" : s); }
    static String b64(byte[] d, int n) { return Base64.encodeToString(d, 0, n, Base64.NO_WRAP); }
    static byte[] unb64(String s) { return Base64.decode(s, Base64.NO_WRAP); }

    @JavascriptInterface
    public String info() {
        return "{\"app\":\"Jet Smart Gauge\",\"android\":" + Build.VERSION.SDK_INT + ",\"model\":" + q(Build.MODEL) + "}";
    }

    /** Stable per-device id for the licence (first 10 hex chars of SHA-256(ANDROID_ID)). */
    @JavascriptInterface
    public String deviceId() {
        try {
            String id = android.provider.Settings.Secure.getString(act.getContentResolver(), android.provider.Settings.Secure.ANDROID_ID);
            byte[] h = java.security.MessageDigest.getInstance("SHA-256").digest(("jsg:" + id).getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 5; i++) sb.append(String.format("%02x", h[i]));
            return sb.toString();
        } catch (Exception e) { return ""; }
    }

    /** Opens a web page / APK download in the phone's browser. */
    @JavascriptInterface
    public void openUrl(String url) {
        try {
            if (url == null || !url.startsWith("https://")) return;
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Exception e) { /* ignore */ }
    }

    /** In-app update: download the APK (https only) to cache and hand it to the system installer. Progress → JetEvt('upd', {...}). */
    @JavascriptInterface
    public void installApk(final String url) {
        if (url == null || !url.startsWith("https://")) { emit("upd", "{\"s\":\"err\",\"m\":\"bad url\"}"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
            emit("upd", "{\"s\":\"perm\"}");
            try {
                Intent s = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(s);
            } catch (Exception e) { /* ignore */ }
            return;
        }
        new Thread(() -> {
            try {
                java.io.File dir = new java.io.File(act.getCacheDir(), "updates");
                dir.mkdirs();
                java.io.File out = new java.io.File(dir, "update.apk");
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                int code = c.getResponseCode();
                if (code / 100 == 3) { // cross-host redirect (GitHub → objects.githubusercontent.com)
                    String loc = c.getHeaderField("Location");
                    c.disconnect();
                    c = (java.net.HttpURLConnection) new java.net.URL(loc).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    code = c.getResponseCode();
                }
                if (code != 200) throw new Exception("HTTP " + code);
                long total = c.getContentLengthLong(), got = 0;
                try (java.io.InputStream in = c.getInputStream(); java.io.FileOutputStream fo = new java.io.FileOutputStream(out)) {
                    byte[] buf = new byte[32768];
                    int n, last = -1;
                    while ((n = in.read(buf)) > 0) {
                        fo.write(buf, 0, n);
                        got += n;
                        int pct = total > 0 ? (int) (got * 100 / total) : 0;
                        if (pct != last) { last = pct; emit("upd", "{\"s\":\"dl\",\"p\":" + pct + "}"); }
                    }
                }
                Uri uri = androidx.core.content.FileProvider.getUriForFile(act, act.getPackageName() + ".fileprovider", out);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(i);
                emit("upd", "{\"s\":\"done\"}");
            } catch (Exception e) {
                emit("upd", "{\"s\":\"err\",\"m\":" + q(String.valueOf(e.getMessage())) + "}");
            }
        }).start();
    }

    @JavascriptInterface
    public void keepScreen(boolean on) { act.keepScreen(on); }

    @JavascriptInterface
    public void setOrientation(String mode) { act.setOrient(mode); }

    /* ======================= USB serial ======================= */

    UsbSerialProber prober() {
        ProbeTable t = UsbSerialProber.getDefaultProbeTable();
        t.addProduct(0x303A, 0x1001, CdcAcmSerialDriver.class); // ESP32-S3 USB-Serial/JTAG
        t.addProduct(0x303A, 0x0002, CdcAcmSerialDriver.class); // ESP32-S2/S3 TinyUSB CDC
        t.addProduct(0x303A, 0x4001, CdcAcmSerialDriver.class);
        return new UsbSerialProber(t);
    }

    @JavascriptInterface
    public String usbList() {
        StringBuilder sb = new StringBuilder("[");
        for (UsbSerialDriver d : prober().findAllDrivers(usbManager)) {
            UsbDevice dev = d.getDevice();
            if (sb.length() > 1) sb.append(',');
            sb.append(q(driverName(d) + String.format(" %04X:%04X", dev.getVendorId(), dev.getProductId())));
        }
        return sb.append(']').toString();
    }

    static String driverName(UsbSerialDriver d) {
        return d.getClass().getSimpleName().replace("SerialDriver", "");
    }

    @JavascriptInterface
    public void usbOpen(final int baud, final boolean quietLines) {
        usbClose();
        List<UsbSerialDriver> list = prober().findAllDrivers(usbManager);
        if (list.isEmpty()) {
            emit("usb-open", "{\"ok\":false,\"err\":" + q("ไม่พบสาย USB-Serial (เสียบสาย OTG แล้วหรือยัง?)") + "}");
            return;
        }
        final UsbSerialDriver drv = list.get(0);
        final UsbDevice dev = drv.getDevice();
        if (usbManager.hasPermission(dev)) {
            openPort(drv, baud, quietLines);
            return;
        }
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                try { act.unregisterReceiver(this); } catch (Exception ignore) { }
                if (i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) openPort(drv, baud, quietLines);
                else emit("usb-open", "{\"ok\":false,\"err\":" + q("ไม่ได้รับอนุญาตให้ใช้ USB") + "}");
            }
        };
        IntentFilter f = new IntentFilter(ACTION_USB_PERM);
        if (Build.VERSION.SDK_INT >= 33) act.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED);
        else act.registerReceiver(r, f);
        int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        Intent pi = new Intent(ACTION_USB_PERM).setPackage(act.getPackageName());
        usbManager.requestPermission(dev, PendingIntent.getBroadcast(act, 0, pi, flags));
    }

    void openPort(UsbSerialDriver drv, int baud, boolean quietLines) {
        try {
            UsbDeviceConnection c = usbManager.openDevice(drv.getDevice());
            if (c == null) throw new Exception("เปิดอุปกรณ์ USB ไม่ได้");
            UsbSerialPort p = drv.getPorts().get(0);
            p.open(c);
            p.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
            if (quietLines) {   // ESP32 boards reset when DTR/RTS toggle
                try { p.setDTR(false); p.setRTS(false); } catch (Exception ignore) { }
            }
            try { p.getClass().getMethod("setLatencyTimer", int.class).invoke(p, 1); } catch (Exception ignore) { }
            port = p;
            io = new SerialInputOutputManager(p, new SerialInputOutputManager.Listener() {
                @Override
                public void onNewData(byte[] data) {
                    emit("usb-data", q(b64(data, data.length)));
                }

                @Override
                public void onRunError(Exception e) {
                    emit("usb-lost", q(String.valueOf(e.getMessage())));
                }
            });
            ioExec = Executors.newSingleThreadExecutor();
            ioExec.submit(io);
            UsbDevice d = drv.getDevice();
            emit("usb-open", "{\"ok\":true,\"name\":" + q(driverName(drv) + String.format(" %04X:%04X", d.getVendorId(), d.getProductId())) + "}");
        } catch (Exception e) {
            usbClose();
            emit("usb-open", "{\"ok\":false,\"err\":" + q("USB: " + e.getMessage()) + "}");
        }
    }

    @JavascriptInterface
    public boolean usbWrite(String b64) {
        try {
            if (port == null) return false;
            port.write(unb64(b64), 500);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean usbSetBreak(boolean on) {
        try { if (port == null) return false; port.setBreak(on); return true; } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public boolean usbSetBaud(int baud) {
        try {
            if (port == null) return false;
            port.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, usbParity);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public void usbClose() {
        try { if (io != null) io.stop(); } catch (Exception ignore) { }
        io = null;
        try { if (ioExec != null) ioExec.shutdownNow(); } catch (Exception ignore) { }
        ioExec = null;
        try { if (port != null) port.close(); } catch (Exception ignore) { }
        port = null;
    }

    /* ======================= Bluetooth LE (Nordic UART) ======================= */

    @JavascriptInterface
    public void bleConnect() { ui.post(this::bleScanDialog); }

    void bleFail(String msg) { emit("ble-open", "{\"ok\":false,\"err\":" + q(msg) + "}"); }

    void bleScanDialog() {
        if (!act.hasBlePermission()) {
            act.askPermissions();
            bleFail("กรุณาอนุญาตสิทธิ์ Bluetooth/อุปกรณ์ใกล้เคียง แล้วกดเชื่อมต่ออีกครั้ง");
            return;
        }
        BluetoothManager bm = (BluetoothManager) act.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter ad = bm == null ? null : bm.getAdapter();
        if (ad == null) { bleFail("เครื่องนี้ไม่มี Bluetooth"); return; }
        if (!ad.isEnabled()) { bleFail("เปิด Bluetooth ก่อน"); return; }
        bleClose();
        scanner = ad.getBluetoothLeScanner();
        if (scanner == null) { bleFail("เปิด Bluetooth ก่อน"); return; }

        final ArrayList<BluetoothDevice> found = new ArrayList<>();
        final ArrayAdapter<String> names = new ArrayAdapter<>(act, android.R.layout.select_dialog_item);
        final boolean[] done = {false};
        final AlertDialog dlg = new AlertDialog.Builder(act)
                .setTitle("เลือก Smart Gauge (กำลังค้นหา…)")
                .setAdapter(names, (d, which) -> {
                    done[0] = true;
                    stopScan();
                    bleGattConnect(found.get(which));
                })
                .setNegativeButton("ยกเลิก", (d, w) -> { })
                .create();
        dlg.setOnDismissListener(d -> {
            stopScan();
            if (!done[0]) bleFail("ยกเลิก");
        });
        scanCb = new ScanCallback() {
            @Override
            public void onScanResult(int type, ScanResult r) {
                BluetoothDevice dev = r.getDevice();
                for (BluetoothDevice x : found) if (x.getAddress().equals(dev.getAddress())) return;
                ScanRecord rec = r.getScanRecord();
                String n = rec != null ? rec.getDeviceName() : null;
                if (n == null) n = dev.getName();
                boolean nus = false;
                if (rec != null && rec.getServiceUuids() != null)
                    for (ParcelUuid u : rec.getServiceUuids()) if (NUS.equals(u.getUuid())) nus = true;
                if (n == null && !nus) return;
                found.add(dev);
                names.add((nus ? "★ " : "") + (n == null ? "(ไม่มีชื่อ)" : n) + "   " + dev.getAddress());
                names.notifyDataSetChanged();
            }
        };
        dlg.show();
        ScanSettings st = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        scanner.startScan(null, st, scanCb);
        ui.postDelayed(() -> {
            stopScan();
            if (dlg.isShowing()) dlg.setTitle(found.isEmpty() ? "ไม่พบอุปกรณ์ — เปิดเกจแล้วลองใหม่" : "เลือก Smart Gauge");
        }, 12000);
    }

    void stopScan() {
        try { if (scanner != null && scanCb != null) scanner.stopScan(scanCb); } catch (Exception ignore) { }
        scanCb = null;
    }

    void bleGattConnect(final BluetoothDevice dev) {
        bleReady = false;
        mtu = 23;
        bleQ.clear();
        bleWriting = false;
        final String name = dev.getName() == null ? dev.getAddress() : dev.getName();
        final boolean[] discStarted = {false};
        BluetoothGattCallback cb = new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt g, int status, int state) {
                if (state == BluetoothProfile.STATE_CONNECTED) {
                    // shortest connection interval: BLE adapters answer a live request in tens of ms instead of ~100 ms+
                    try { g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH); } catch (Throwable ignore) { }
                    g.requestMtu(247);
                    // some OBD dongles never answer the MTU request: start service discovery anyway
                    ui.postDelayed(() -> { if (!discStarted[0]) { discStarted[0] = true; g.discoverServices(); } }, 2000);
                } else if (state == BluetoothProfile.STATE_DISCONNECTED) {
                    if (bleReady) emit("ble-lost", "{\"why\":" + q("BLE ขาด (status " + status + ")") + "}");
                    else bleFail("เชื่อมต่อ Bluetooth ไม่สำเร็จ (status " + status + ")");
                    bleReady = false;
                    g.close();
                    if (gatt == g) gatt = null;
                }
            }

            @Override
            public void onMtuChanged(BluetoothGatt g, int m, int status) {
                if (status == BluetoothGatt.GATT_SUCCESS) mtu = m;
                if (!discStarted[0]) { discStarted[0] = true; g.discoverServices(); }
            }

            @Override
            public void onServicesDiscovered(BluetoothGatt g, int status) {
                if (!pickUart(g)) { bleFail("อุปกรณ์นี้ไม่มีช่องสื่อสารแบบ UART ที่รองรับ (ถ้าเป็น ELM327 แบบ Bluetooth ธรรมดา ให้จับคู่ในตั้งค่ามือถือก่อน)"); g.disconnect(); return; }
                g.setCharacteristicNotification(txCh, true);
                BluetoothGattDescriptor d = txCh.getDescriptor(CCCD);
                if (d == null) { bleReady = true; emit("ble-open", "{\"ok\":true,\"name\":" + q(name) + "}"); return; }
                final byte[] en = (txCh.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
                        ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE : BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
                if (Build.VERSION.SDK_INT >= 33) {
                    g.writeDescriptor(d, en);
                } else {
                    d.setValue(en);
                    g.writeDescriptor(d);
                }
            }

            @Override
            public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
                bleReady = true;
                emit("ble-open", "{\"ok\":true,\"name\":" + q(name) + ",\"mtu\":" + mtu + "}");
            }

            @Override
            public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value) {
                emit("ble-data", q(b64(value, value.length)));
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
                byte[] v = c.getValue();
                if (v != null) emit("ble-data", q(b64(v, v.length)));
            }

            @Override
            public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
                synchronized (bleQ) { bleWriting = false; }
                pump();
            }
        };
        if (Build.VERSION.SDK_INT >= 23) gatt = dev.connectGatt(act, false, cb, BluetoothDevice.TRANSPORT_LE);
        else gatt = dev.connectGatt(act, false, cb);
    }

    @JavascriptInterface
    public boolean bleWrite(String b64) {
        if (gatt == null || rxCh == null || !bleReady) return false;
        byte[] all = unb64(b64);
        int chunk = Math.max(20, Math.min(mtu - 3, 180));
        for (int o = 0; o < all.length; o += chunk) {
            int n = Math.min(chunk, all.length - o);
            byte[] c = new byte[n];
            System.arraycopy(all, o, c, 0, n);
            bleQ.add(c);
        }
        pump();
        return true;
    }

    @SuppressWarnings("deprecation")
    void pump() {
        byte[] c;
        synchronized (bleQ) {
            if (bleWriting || gatt == null || rxCh == null) return;
            c = bleQ.poll();
            if (c == null) return;
            bleWriting = true;
        }
        boolean ok;
        final int pr = rxCh.getProperties();
        final int wt = ((pr & BluetoothGattCharacteristic.PROPERTY_WRITE) == 0 && (pr & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0)
                ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
        if (Build.VERSION.SDK_INT >= 33) {
            ok = gatt.writeCharacteristic(rxCh, c, wt) == 0;
        } else {
            rxCh.setWriteType(wt);
            rxCh.setValue(c);
            ok = gatt.writeCharacteristic(rxCh);
        }
        if (!ok) {   // busy -> retry shortly
            synchronized (bleQ) { bleWriting = false; }
            bleQ.offerFirst(c);
            ui.postDelayed(this::pump, 15);
        }
    }

    @JavascriptInterface
    public void bleClose() {
        bleReady = false;
        bleQ.clear();
        try { if (gatt != null) { gatt.disconnect(); gatt.close(); } } catch (Exception ignore) { }
        gatt = null;
    }


    /* ======================= unified Bluetooth finder (BLE + classic + paired) ======================= */

    static final String[][] UARTS = {
        {"6e400001-b5a3-f393-e0a9-e50e24dcca9e", "6e400002-b5a3-f393-e0a9-e50e24dcca9e", "6e400003-b5a3-f393-e0a9-e50e24dcca9e"},   // Nordic UART (Smart Gauge)
        {"0000fff0-0000-1000-8000-00805f9b34fb", "0000fff2-0000-1000-8000-00805f9b34fb", "0000fff1-0000-1000-8000-00805f9b34fb"},   // vGate / Veepeak / many ELM BLE
        {"0000ffe0-0000-1000-8000-00805f9b34fb", "0000ffe1-0000-1000-8000-00805f9b34fb", "0000ffe1-0000-1000-8000-00805f9b34fb"},   // HM-10 style
        {"000018f0-0000-1000-8000-00805f9b34fb", "00002af1-0000-1000-8000-00805f9b34fb", "00002af0-0000-1000-8000-00805f9b34fb"},   // OBDLink / Carista style
        {"49535343-fe7d-4ae5-8fa9-9fafd205e455", "49535343-8841-43f4-a8d4-ecbe34729bb3", "49535343-1e4d-4bd9-ba61-23c647249616"},   // ISSC / Microchip
    };
    static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");

    /** chooses write (rxCh) + notify (txCh) characteristics: known UART services first, then any service with notify+write */
    boolean pickUart(BluetoothGatt g) {
        for (String[] u : UARTS) {
            BluetoothGattService sv = g.getService(UUID.fromString(u[0]));
            if (sv == null) continue;
            BluetoothGattCharacteristic w = sv.getCharacteristic(UUID.fromString(u[1])), n = sv.getCharacteristic(UUID.fromString(u[2]));
            if (w != null && n != null) { rxCh = w; txCh = n; return true; }
        }
        for (BluetoothGattService sv : g.getServices()) {
            String id = sv.getUuid().toString();
            if (id.startsWith("00001800") || id.startsWith("00001801") || id.startsWith("0000180a")) continue;
            BluetoothGattCharacteristic w = null, n = null;
            for (BluetoothGattCharacteristic c : sv.getCharacteristics()) {
                int p = c.getProperties();
                if (n == null && (p & (BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_INDICATE)) != 0) n = c;
                if (w == null && (p & (BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0) w = c;
            }
            if (w != null && n != null) { rxCh = w; txCh = n; return true; }
        }
        return false;
    }

    static String kindOf(String n, boolean nus) {
        if (nus) return "gauge";
        if (n == null) return "other";
        String l = n.toLowerCase();
        if (l.startsWith("mfb") || l.startsWith("jet")) return "gauge";
        if (l.matches(".*(honda-kline|k-?line|honda.?bridge).*")) return "obd";   // our own HONDA-KLINE bridge (ELM327 emulation)
        if (l.matches(".*(elm|obd|vlink|v-link|vgate|veepeak|konnwei|kw9|kw8|icar|carista|bafx|autel|launch|thinkdiag|fixd|viecar|kingbolen|diag|scan|can.?bus|v1\\.5|v2\\.1|android-vlink|ios-vlink).*")) return "obd";
        return "other";
    }

    static class Ent {
        BluetoothDevice dev; String name; boolean ble, classic, bonded, nus; int rssi = -127;
        String kind() { return kindOf(name, nus); }
    }

    BroadcastReceiver discRx;

    void stopBt() {
        stopScan();
        try { if (discRx != null) act.unregisterReceiver(discRx); } catch (Exception ignore) { }
        discRx = null;
        try {
            BluetoothManager bm = (BluetoothManager) act.getSystemService(Context.BLUETOOTH_SERVICE);
            if (bm != null && bm.getAdapter() != null) bm.getAdapter().cancelDiscovery();
        } catch (Exception ignore) { }
    }

    /** mode: "all" | "obd" | "gauge" (only changes the sort order/title). Result: event 'bt-pick' {ok, addr, name, kind} */
    @JavascriptInterface
    public void btPick(final String mode) {
        ui.post(() -> {
            try { btPickDialog(mode); }
            catch (Throwable e) { btFail("ค้นหา Bluetooth ผิดพลาด: " + e); }
        });
    }

    @JavascriptInterface
    public void openAppSettings() {
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + act.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Exception ignore) { }
    }

    @JavascriptInterface
    public void openBtSettings() {
        try { Intent i = new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); act.startActivity(i); } catch (Exception ignore) { }
    }

    void btFail(String msg) { emit("bt-pick", "{\"ok\":false,\"err\":" + q(msg) + "}"); }

    void btPickDialog(final String mode) {
        if (!act.hasBlePermission()) { act.askPermissions(); btFail("PERM:ยังไม่ได้อนุญาตสิทธิ์ “อุปกรณ์ใกล้เคียง/Bluetooth” — กดอนุญาต แล้วกดค้นหาอีกครั้ง (ถ้าไม่ขึ้นช่องถาม ให้ไปตั้งค่าแอป → สิทธิ์)"); return; }
        if (Build.VERSION.SDK_INT < 31) {
            try {
                android.location.LocationManager lm = (android.location.LocationManager) act.getSystemService(Context.LOCATION_SERVICE);
                boolean on = lm != null && (lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER));
                if (!on) { btFail("LOC:Android รุ่นนี้ต้องเปิด “ตำแหน่ง (Location/GPS)” ก่อนจึงจะค้นหา Bluetooth เจอ — เปิดแล้วกดค้นหาอีกครั้ง"); return; }
            } catch (Exception ignore) { }
        }
        BluetoothManager bm = (BluetoothManager) act.getSystemService(Context.BLUETOOTH_SERVICE);
        final BluetoothAdapter ad = bm == null ? null : bm.getAdapter();
        if (ad == null) { btFail("เครื่องนี้ไม่มี Bluetooth"); return; }
        if (!ad.isEnabled()) { btFail("เปิด Bluetooth ก่อน"); return; }
        bleClose();
        stopBt();

        final ArrayList<Ent> ents = new ArrayList<>();
        final ArrayList<Ent> shown = new ArrayList<>();
        final ArrayAdapter<String> lab = new ArrayAdapter<>(act, android.R.layout.select_dialog_item);
        final boolean[] done = {false};
        final Runnable[] refresh = new Runnable[1];
        final String want = "obd".equals(mode) ? "obd" : "gauge".equals(mode) ? "gauge" : "";
        refresh[0] = () -> {
            shown.clear();
            for (Ent e : ents) shown.add(e);
            java.util.Collections.sort(shown, (a, b) -> {
                int ra = rank(a, want), rb = rank(b, want);
                if (ra != rb) return ra - rb;
                return b.rssi - a.rssi;
            });
            lab.clear();
            for (Ent e : shown) {
                String k = e.kind();
                String tag = "gauge".equals(k) ? "★ Smart Gauge · " : "obd".equals(k) ? "🚗 OBD · " : "";
                String how = e.bonded ? "จับคู่แล้ว" : (e.classic && !e.ble ? "Bluetooth" : "BLE");
                lab.add(tag + (e.name == null ? "(ไม่มีชื่อ)" : e.name) + "\n" + e.dev.getAddress() + "  ·  " + how + (e.rssi > -127 ? "  ·  " + e.rssi + " dBm" : ""));
            }
            lab.notifyDataSetChanged();
        };
        final AlertDialog dlg = new AlertDialog.Builder(act)
                .setTitle("ค้นหาอุปกรณ์ Bluetooth (กำลังค้นหา…)")
                .setAdapter(lab, (d, which) -> {
                    done[0] = true;
                    stopBt();
                    Ent e = shown.get(which);
                    emit("bt-pick", "{\"ok\":true,\"addr\":" + q(e.dev.getAddress()) + ",\"name\":" + q(e.name == null ? e.dev.getAddress() : e.name)
                            + ",\"kind\":" + q(e.kind()) + ",\"ble\":" + e.ble + ",\"classic\":" + (e.classic || e.bonded) + ",\"bonded\":" + e.bonded + "}");
                })
                .setNegativeButton("ยกเลิก", (d, w) -> { })
                .setNeutralButton("ค้นหาใหม่", null)
                .create();
        dlg.setOnDismissListener(d -> { stopBt(); if (!done[0]) btFail("ยกเลิก"); });

        final Runnable[] startScan = new Runnable[1];
        startScan[0] = () -> {
            stopBt();
            // 1) devices already paired with the phone (ELM327 clones are almost always here)
            try {
                for (BluetoothDevice bd : ad.getBondedDevices()) addEnt(ents, bd, true, false, true, false, -127);
            } catch (Exception ignore) { }
            refresh[0].run();
            if (!ents.isEmpty()) dlg.setTitle("เลือกอุปกรณ์ (กำลังค้นหาเพิ่ม…)");
            // 2) classic discovery
            discRx = new BroadcastReceiver() {
                @Override @SuppressWarnings("deprecation")
                public void onReceive(Context c, Intent i) {
                    String a = i.getAction();
                    if (BluetoothDevice.ACTION_FOUND.equals(a)) {
                        BluetoothDevice bd = i.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                        short rssi = i.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE);
                        if (bd != null) { addEnt(ents, bd, false, true, bd.getBondState() == BluetoothDevice.BOND_BONDED, false, rssi == Short.MIN_VALUE ? -127 : rssi); refresh[0].run(); }
                    } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(a)) {
                        if (dlg.isShowing() && ents.isEmpty()) dlg.setTitle("ไม่พบอุปกรณ์ — เสียบ ELM327 ที่รถ/เปิดเกจ แล้วกด “ค้นหาใหม่”");
                    }
                }
            };
            IntentFilter f = new IntentFilter(BluetoothDevice.ACTION_FOUND);
            f.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
            try {
                if (Build.VERSION.SDK_INT >= 33) act.registerReceiver(discRx, f, Context.RECEIVER_EXPORTED);
                else act.registerReceiver(discRx, f);
                ad.startDiscovery();
            } catch (Throwable ignore) { }
            // 3) BLE scan
            scanner = ad.getBluetoothLeScanner();
            if (scanner != null) {
                scanCb = new ScanCallback() {
                    @Override
                    public void onScanResult(int type, ScanResult r) {
                        BluetoothDevice bd = r.getDevice();
                        ScanRecord rec = r.getScanRecord();
                        boolean nus = false;
                        if (rec != null && rec.getServiceUuids() != null)
                            for (ParcelUuid u : rec.getServiceUuids()) if (NUS.equals(u.getUuid())) nus = true;
                        String n = rec != null ? rec.getDeviceName() : null;
                        if (n == null) n = bd.getName();
                        Ent e = addEnt(ents, bd, false, false, bd.getBondState() == BluetoothDevice.BOND_BONDED, true, r.getRssi());
                        if (n != null && e.name == null) e.name = n;
                        if (nus) e.nus = true;
                        refresh[0].run();
                    }
                };
                try { scanner.startScan(null, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCb); } catch (Exception ignore) { }
            }
            ui.postDelayed(() -> { if (dlg.isShowing() && !done[0]) dlg.setTitle(ents.isEmpty() ? "ไม่พบอุปกรณ์ — เสียบ ELM327 ที่รถ เปิดกุญแจ ON แล้วกด “ค้นหาใหม่”" : "เลือกอุปกรณ์"); }, 12000);
        };
        dlg.show();
        dlg.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> { ents.clear(); refresh[0].run(); dlg.setTitle("ค้นหาอุปกรณ์ Bluetooth (กำลังค้นหา…)"); startScan[0].run(); });
        startScan[0].run();
    }

    static int rank(Ent e, String want) {
        String k = e.kind();
        if (!want.isEmpty() && want.equals(k)) return 0;
        if ("gauge".equals(k) || "obd".equals(k)) return 1;
        if (e.name != null) return e.bonded ? 2 : 3;
        return 4;
    }

    Ent addEnt(ArrayList<Ent> list, BluetoothDevice bd, boolean bonded, boolean classic, boolean isBonded, boolean ble, int rssi) {
        Ent e = null;
        for (Ent x : list) if (x.dev.getAddress().equals(bd.getAddress())) { e = x; break; }
        if (e == null) { e = new Ent(); e.dev = bd; list.add(e); }
        String n = null;
        try { n = bd.getName(); } catch (Exception ignore) { }
        if (n != null) e.name = n;
        e.bonded |= bonded || isBonded;
        e.classic |= classic;
        e.ble |= ble;
        if (rssi > e.rssi) e.rssi = rssi;
        if (!e.ble && !e.classic) { try { int t = bd.getType(); e.classic = t == BluetoothDevice.DEVICE_TYPE_CLASSIC || t == BluetoothDevice.DEVICE_TYPE_DUAL; e.ble = t == BluetoothDevice.DEVICE_TYPE_LE || t == BluetoothDevice.DEVICE_TYPE_DUAL; } catch (Exception ignore) { } }
        return e;
    }

    /** open a picked device over BLE UART (answers with 'ble-open') */
    @JavascriptInterface
    public void bleOpen(final String addr) {
        ui.post(() -> {
            try {
                BluetoothManager bm = (BluetoothManager) act.getSystemService(Context.BLUETOOTH_SERVICE);
                bleClose();
                bleGattConnect(bm.getAdapter().getRemoteDevice(addr));
            } catch (Exception e) { bleFail("เชื่อมต่อไม่สำเร็จ: " + e.getMessage()); }
        });
    }

    /* ======================= classic Bluetooth SPP (ELM327 mini etc.) ======================= */

    BluetoothSocket sock;
    java.io.OutputStream sockOut;
    volatile boolean sppUp = false;
    volatile int sppGen = 0;      // every open/close starts a new generation: an old reader thread that wakes up late must not touch the new connection (nor report it lost)

    @JavascriptInterface
    public void sppOpen(final String addr) {
        sppClose();
        final int gen = ++sppGen;
        new Thread(() -> {
            String err = "", why = "";
            try {
                BluetoothManager bm = (BluetoothManager) act.getSystemService(Context.BLUETOOTH_SERVICE);
                BluetoothAdapter ad = bm.getAdapter();
                ad.cancelDiscovery();
                BluetoothDevice dev = ad.getRemoteDevice(addr);
                if (dev.getBondState() != BluetoothDevice.BOND_BONDED) {
                    // pair first (phone shows the PIN box: ELM327 = 1234 or 0000) and wait for it
                    final java.util.concurrent.CountDownLatch bonded = new java.util.concurrent.CountDownLatch(1);
                    BroadcastReceiver br = new BroadcastReceiver() {
                        @Override public void onReceive(Context c, Intent i) {
                            BluetoothDevice d = i.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                            if (d != null && addr.equalsIgnoreCase(d.getAddress()) && i.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, -1) == BluetoothDevice.BOND_BONDED) bonded.countDown();
                        }
                    };
                    try {
                        IntentFilter bf = new IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
                        if (Build.VERSION.SDK_INT >= 33) act.registerReceiver(br, bf, Context.RECEIVER_EXPORTED); else act.registerReceiver(br, bf);
                        dev.createBond();
                        bonded.await(60, java.util.concurrent.TimeUnit.SECONDS);
                    } catch (Exception ignore) { }
                    try { act.unregisterReceiver(br); } catch (Exception ignore) { }
                    if (dev.getBondState() != BluetoothDevice.BOND_BONDED) throw new Exception("จับคู่ไม่สำเร็จ — ใส่ PIN 1234 หรือ 0000 ในช่องที่เด้งขึ้น (หรือจับคู่ในตั้งค่า Bluetooth ของมือถือก่อน)");
                    Thread.sleep(800);
                }
                BluetoothSocket s = null;
                for (int attempt = 0; attempt < 5 && s == null; attempt++) {
                    try {
                        BluetoothSocket t;
                        if (attempt == 0 || attempt == 3) t = dev.createRfcommSocketToServiceRecord(SPP);               // secure
                        else if (attempt == 1 || attempt == 4) t = dev.createInsecureRfcommSocketToServiceRecord(SPP); // insecure
                        else t = (BluetoothSocket) dev.getClass().getMethod("createRfcommSocket", int.class).invoke(dev, 1);   // channel-1 fallback used by many clones
                        t.connect();
                        s = t;
                    } catch (Exception e) {
                        err = String.valueOf(e.getMessage());
                        try { Thread.sleep(1000); } catch (InterruptedException ignore) { }
                    }
                }
                if (s == null) throw new Exception(err);
                if (gen != sppGen) { try { s.close(); } catch (Exception ignore) { } return; }      // the user closed / reopened meanwhile
                sock = s;
                sockOut = s.getOutputStream();
                sppUp = true;
                String n = dev.getName();
                emit("spp-open", "{\"ok\":true,\"name\":" + q(n == null ? addr : n) + "}");
                java.io.InputStream in = s.getInputStream();
                byte[] buf = new byte[1024];
                int n2;
                while (sppUp && gen == sppGen && (n2 = in.read(buf)) > 0) emit("spp-data", q(b64(buf, n2)));
                if (sppUp && gen == sppGen) why = "อแดปเตอร์ปิดการเชื่อมต่อเอง (ลิงก์ Bluetooth ถูกตัดจากฝั่งตัวอแดปเตอร์)";
            } catch (Exception e) {
                if (gen != sppGen) return;                       // closed on purpose / replaced: nothing to report
                if (sppUp) why = "อ่านข้อมูลไม่ได้: " + e.getMessage();
                if (!sppUp) { emit("spp-open", "{\"ok\":false,\"err\":" + q("เชื่อมต่อไม่สำเร็จ: " + e.getMessage() + " — ตรวจว่าเสียบ ELM327 ที่รถและเปิดกุญแจ ON (ไฟบนตัว ELM ติด), ลบการจับคู่เก่าแล้วจับคู่ใหม่ PIN 1234/0000") + "}"); return; }
            }
            if (sppUp && gen == sppGen) { sppUp = false; emit("spp-lost", "{\"why\":" + q(why) + "}"); }
        }, "spp-io").start();
    }

    @JavascriptInterface
    public boolean sppWrite(String b64) {
        try {
            if (!sppUp || sockOut == null) return false;
            synchronized (this) { sockOut.write(unb64(b64)); sockOut.flush(); }
            return true;
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public void sppClose() {
        sppGen++;
        sppUp = false;
        try { if (sock != null) sock.close(); } catch (Exception ignore) { }
        sock = null;
        sockOut = null;
    }


    /* ======================= Wi-Fi OBD-II adapters (ELM327 Wi-Fi: the phone joins the adapter's Wi-Fi, then TCP, usually 192.168.0.10:35000) ======================= */

    volatile Network wifiNet;                       // set by wifiJoin (Android 10+ network request); otherwise the Wi-Fi network the phone is on
    ConnectivityManager.NetworkCallback wifiCb;
    java.net.Socket tcp;
    java.io.OutputStream tcpOut;
    volatile boolean tcpUp = false;
    volatile int tcpGen = 0;

    ConnectivityManager cm() { return (ConnectivityManager) act.getSystemService(Context.CONNECTIVITY_SERVICE); }

    /** The Wi-Fi network sockets must use (works although that Wi-Fi has no internet and mobile data is the default network). */
    Network findWifi() {
        if (wifiNet != null) return wifiNet;
        try {
            ConnectivityManager c = cm();
            if (c == null) return null;
            Network best = null;
            for (Network n : c.getAllNetworks()) {
                NetworkCapabilities nc = c.getNetworkCapabilities(n);
                if (nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) best = n;
            }
            return best;
        } catch (Exception e) { return null; }
    }

    String gatewayOf(Network n) {
        try {
            LinkProperties lp = cm().getLinkProperties(n);
            if (lp != null) for (RouteInfo r : lp.getRoutes())
                if (r.isDefaultRoute() && r.getGateway() instanceof java.net.Inet4Address) return r.getGateway().getHostAddress();
        } catch (Exception ignore) { }
        return null;
    }

    java.net.Socket wifiSocket(Network n) throws java.io.IOException {
        java.net.Socket sk = new java.net.Socket();
        if (n != null) n.bindSocket(sk);
        return sk;
    }

    /** Looks for an ELM327 Wi-Fi adapter on the phone's Wi-Fi + lists nearby networks. Result: event 'wifi-search' */
    @JavascriptInterface
    public void wifiSearch() {
        new Thread(() -> {
            try {
                WifiManager wm = (WifiManager) act.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                boolean wifiOn = wm != null && wm.isWifiEnabled();
                Network n = wifiOn ? findWifi() : null;
                String gw = n == null ? null : gatewayOf(n);
                String ssid = "";
                try { if (wm != null && wm.getConnectionInfo() != null && wm.getConnectionInfo().getSSID() != null) ssid = wm.getConnectionInfo().getSSID().replace("\"", ""); } catch (Exception ignore) { }
                if ("<unknown ssid>".equals(ssid)) ssid = "";
                final java.util.LinkedHashSet<String> hosts = new java.util.LinkedHashSet<>();
                if (gw != null) hosts.add(gw);
                for (String h : new String[]{"192.168.0.10", "192.168.4.1", "192.168.1.5", "192.168.0.74", "192.168.1.10", "192.168.10.1"}) hosts.add(h);
                final int[] ports = {35000, 23};
                final JSONObject out = new JSONObject();
                final org.json.JSONArray devs = new org.json.JSONArray();
                if (n != null) {
                    final Network fn = n;
                    ExecutorService ex = Executors.newFixedThreadPool(8);
                    ArrayList<java.util.concurrent.Future<JSONObject>> fut = new ArrayList<>();
                    for (final String h : hosts) for (final int pt : ports) {
                        if (!h.equals(gw) && pt != 35000) continue;      // port 23 only on the gateway itself
                        fut.add(ex.submit(() -> probe(fn, h, pt)));
                    }
                    for (java.util.concurrent.Future<JSONObject> f : fut) {
                        try { JSONObject o = f.get(6, java.util.concurrent.TimeUnit.SECONDS); if (o != null) devs.put(o); } catch (Exception ignore) { }
                    }
                    ex.shutdownNow();
                }
                // nearby networks (needs the Location permission; best effort)
                org.json.JSONArray nets = new org.json.JSONArray();
                boolean loc = act.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
                if (wm != null && wifiOn && loc) {
                    try { wm.startScan(); } catch (Exception ignore) { }
                    try {
                        java.util.HashSet<String> seen = new java.util.HashSet<>();
                        List<android.net.wifi.ScanResult> res = wm.getScanResults();
                        java.util.Collections.sort(res, (a, b) -> b.level - a.level);
                        for (android.net.wifi.ScanResult r : res) {
                            if (r.SSID == null || r.SSID.isEmpty() || !seen.add(r.SSID)) continue;
                            boolean obd = r.SSID.matches("(?i).*(obd|elm|v-?link|vgate|clkdevice|konnwei|super|wifi_|wi-fi_).*");
                            JSONObject o = new JSONObject();
                            o.put("ssid", r.SSID); o.put("level", r.level); o.put("obd", obd);
                            o.put("open", r.capabilities == null || !(r.capabilities.contains("WPA") || r.capabilities.contains("WEP") || r.capabilities.contains("SAE")));
                            nets.put(o);
                            if (nets.length() >= 25) break;
                        }
                    } catch (Exception ignore) { }
                }
                out.put("ok", true); out.put("wifiOn", wifiOn); out.put("onWifi", n != null); out.put("ssid", ssid); out.put("gateway", gw == null ? "" : gw);
                out.put("devices", devs); out.put("nets", nets); out.put("loc", loc); out.put("sdk", Build.VERSION.SDK_INT);
                emit("wifi-search", out.toString());
            } catch (Throwable e) {
                emit("wifi-search", "{\"ok\":false,\"err\":" + q("ค้นหา WiFi ผิดพลาด: " + e) + "}");
            }
        }, "wifi-search").start();
    }

    /** TCP connect + "ATI": an ELM327 answers with its name and the '>' prompt. */
    JSONObject probe(Network n, String host, int port) {
        java.net.Socket sk = null;
        try {
            sk = wifiSocket(n);
            sk.connect(new java.net.InetSocketAddress(host, port), 900);
            boolean elm = false;
            try {
                sk.setSoTimeout(1200);
                sk.getOutputStream().write("ATI\r".getBytes("US-ASCII"));
                sk.getOutputStream().flush();
                java.io.InputStream in = sk.getInputStream();
                byte[] b = new byte[128];
                int k = in.read(b);
                if (k > 0) { String t = new String(b, 0, k, "US-ASCII"); elm = t.contains("ELM") || t.contains(">") || t.contains("OBD"); }
            } catch (Exception ignore) { }
            JSONObject o = new JSONObject();
            o.put("host", host); o.put("port", port); o.put("elm", elm);
            return o;
        } catch (Exception e) { return null; }
        finally { try { if (sk != null) { try { sk.setSoLinger(true, 0); } catch (Exception ignore) { } sk.close(); } } catch (Exception ignore) { } }      // RST: a WiFi adapter serves one client — free it at once
    }

    /** Android 10+: join an adapter's Wi-Fi from inside the app (the system asks the user to confirm). Result: event 'wifi-join' */
    @JavascriptInterface
    public void wifiJoin(final String ssid, final String pass) {
        if (Build.VERSION.SDK_INT < 29) { emit("wifi-join", "{\"ok\":false,\"manual\":true,\"err\":" + q("Android รุ่นนี้ต้องต่อ WiFi ของอแดปเตอร์เองในหน้าตั้งค่า WiFi") + "}"); return; }
        ui.post(() -> joinApi29(ssid, pass));
    }

    @android.annotation.TargetApi(Build.VERSION_CODES.Q)
    void joinApi29(final String ssid, final String pass) {
        {
            try {
                ConnectivityManager c = cm();
                if (wifiCb != null) { try { c.unregisterNetworkCallback(wifiCb); } catch (Exception ignore) { } wifiCb = null; }
                android.net.wifi.WifiNetworkSpecifier.Builder sb = new android.net.wifi.WifiNetworkSpecifier.Builder().setSsid(ssid);
                if (pass != null && pass.length() >= 8) sb.setWpa2Passphrase(pass);
                NetworkRequest req = new NetworkRequest.Builder()
                        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                        .setNetworkSpecifier(sb.build()).build();
                wifiCb = new ConnectivityManager.NetworkCallback() {
                    @Override public void onAvailable(Network n) { wifiNet = n; emit("wifi-join", "{\"ok\":true,\"ssid\":" + q(ssid) + "}"); }
                    @Override public void onUnavailable() { emit("wifi-join", "{\"ok\":false,\"err\":" + q("ไม่ได้เชื่อม WiFi “" + ssid + "” (ไม่พบสัญญาณ รหัสผ่านไม่ถูก หรือกดไม่อนุญาต)") + "}"); }
                    @Override public void onLost(Network n) {
                        if (wifiNet == n) wifiNet = null;
                        if (tcpUp) { tcpUp = false; try { if (tcp != null) tcp.close(); } catch (Exception ignore) { } emit("tcp-lost", "{\"why\":" + q("WiFi ของอแดปเตอร์หลุด") + "}"); }
                    }
                };
                c.requestNetwork(req, wifiCb, 30000);
            } catch (Throwable e) { emit("wifi-join", "{\"ok\":false,\"err\":" + q("เชื่อม WiFi ไม่สำเร็จ: " + e.getMessage()) + "}"); }
        }
    }

    @JavascriptInterface
    public void openWifiSettings() {
        try { Intent i = new Intent(android.provider.Settings.ACTION_WIFI_SETTINGS); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); act.startActivity(i); } catch (Exception ignore) { }
    }

    @JavascriptInterface
    public void tcpOpen(final String host, final int port) {
        tcpClose();
        final int gen = ++tcpGen;
        new Thread(() -> {
            String why = "";
            try {
                Network n = findWifi();
                if (n == null) throw new Exception("ยังไม่ได้ต่อ WiFi ของอแดปเตอร์ — ต่อ WiFi (ชื่อ เช่น WiFi_OBDII / V-LINK) ในหน้าตั้งค่า WiFi ก่อน");
                java.net.Socket s = wifiSocket(n);
                s.setTcpNoDelay(true);
                s.setKeepAlive(true);
                s.connect(new java.net.InetSocketAddress(host, port), 5000);
                if (gen != tcpGen) { try { s.close(); } catch (Exception ignore) { } return; }      // closed / reopened meanwhile
                tcp = s;
                tcpOut = s.getOutputStream();
                tcpUp = true;
                emit("tcp-open", "{\"ok\":true,\"name\":" + q("WiFi OBD2 " + host) + "}");
                java.io.InputStream in = s.getInputStream();
                byte[] buf = new byte[1024];
                int k;
                while (tcpUp && gen == tcpGen && (k = in.read(buf)) > 0) emit("tcp-data", q(b64(buf, k)));
                if (tcpUp && gen == tcpGen) why = "อแดปเตอร์ WiFi ปิดการเชื่อมต่อเอง";
            } catch (Exception e) {
                if (gen != tcpGen) return;                       // closed on purpose / replaced: nothing to report
                if (tcpUp) why = "อ่านข้อมูลไม่ได้: " + e.getMessage();
                else emit("tcp-open", "{\"ok\":false,\"err\":" + q("เชื่อมต่อ " + host + ":" + port + " ไม่สำเร็จ: " + e.getMessage()) + "}");
            }
            if (tcpUp && gen == tcpGen) { tcpUp = false; emit("tcp-lost", "{\"why\":" + q(why) + "}"); }
        }, "tcp-io").start();
    }

    @JavascriptInterface
    public boolean tcpWrite(String b64) {
        try {
            if (!tcpUp || tcpOut == null) return false;
            synchronized (this) { tcpOut.write(unb64(b64)); tcpOut.flush(); }
            return true;
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public void tcpClose() {
        tcpGen++;
        tcpUp = false;
        try { if (tcp != null) tcp.close(); } catch (Exception ignore) { }
        tcp = null;
        tcpOut = null;
    }

    /* ======================= files ======================= */

    @JavascriptInterface
    public String saveFile(String name, String b64, String mime) {
        try {
            byte[] data = unb64(b64);
            String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                v.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/JetHondaTune");
                Uri u = act.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (u == null) return "";
                try (OutputStream os = act.getContentResolver().openOutputStream(u)) { os.write(data); }
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "JetHondaTune");
                dir.mkdirs();
                try (FileOutputStream os = new FileOutputStream(new File(dir, safe))) { os.write(data); }
            }
            return "Download/JetHondaTune/" + safe;
        } catch (Exception e) {
            return "";
        }
    }

    void closeAll() {
        usbClose();
        stopBt();
        bleClose();
        sppClose();
    }
}
