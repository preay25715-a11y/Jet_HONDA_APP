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
import android.net.Uri;
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
        return "{\"app\":\"Jet_HONDA Tune\",\"android\":" + Build.VERSION.SDK_INT + ",\"model\":" + q(Build.MODEL) + "}";
    }

    @JavascriptInterface
    public void keepScreen(boolean on) { act.keepScreen(on); }

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
        BluetoothGattCallback cb = new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt g, int status, int state) {
                if (state == BluetoothProfile.STATE_CONNECTED) {
                    g.requestMtu(247);
                } else if (state == BluetoothProfile.STATE_DISCONNECTED) {
                    if (bleReady) emit("ble-lost", "{}");
                    else bleFail("เชื่อมต่อ Bluetooth ไม่สำเร็จ (status " + status + ")");
                    bleReady = false;
                    g.close();
                    if (gatt == g) gatt = null;
                }
            }

            @Override
            public void onMtuChanged(BluetoothGatt g, int m, int status) {
                if (status == BluetoothGatt.GATT_SUCCESS) mtu = m;
                g.discoverServices();
            }

            @Override
            public void onServicesDiscovered(BluetoothGatt g, int status) {
                BluetoothGattService s = g.getService(NUS);
                if (s == null) { bleFail("อุปกรณ์นี้ไม่มีบริการ MFB-LINK (Nordic UART)"); g.disconnect(); return; }
                rxCh = s.getCharacteristic(NUS_RX);
                txCh = s.getCharacteristic(NUS_TX);
                if (rxCh == null || txCh == null) { bleFail("ไม่พบช่องสื่อสาร RX/TX"); g.disconnect(); return; }
                g.setCharacteristicNotification(txCh, true);
                BluetoothGattDescriptor d = txCh.getDescriptor(CCCD);
                if (d == null) { bleReady = true; emit("ble-open", "{\"ok\":true,\"name\":" + q(name) + "}"); return; }
                if (Build.VERSION.SDK_INT >= 33) {
                    g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                } else {
                    d.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
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
        if (Build.VERSION.SDK_INT >= 33) {
            ok = gatt.writeCharacteristic(rxCh, c, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == 0;
        } else {
            rxCh.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
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
        stopScan();
        bleClose();
    }
}
