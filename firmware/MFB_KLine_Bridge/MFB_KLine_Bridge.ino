/* =====================================================================
 * MFB-PRO Smart Gauge — K-LINE BRIDGE (MFB-LINK v1)   ESP32 / ESP32-S3
 *
 * Lets the MFB-PRO K-LINE FLASHER app use the gauge as its K-line interface
 * over Bluetooth LE (Nordic UART service) or USB serial, and receive .bin files
 * into LittleFS (/ecu/<name>.bin) for the gauge's own FLASH screen.
 *
 * Merge into the existing gauge firmware:
 *   - call  mfbBridgeBegin()  in setup()
 *   - call  mfbBridgeLoop()   in loop()  (non-blocking when idle)
 *   - while mfbBridgeBusy() is true, pause the gauge's own K-line polling
 *   - implement mfbOnFileReceived(path,size) to show the file on the FLASH page
 *
 * Board: Arduino-ESP32 core 2.x/3.x. Partition scheme with SPIFFS/LittleFS.
 * K-line transceiver: L9637D / MC33290 / SI9243 (or 2x PC817 opto circuit)
 * ===================================================================== */
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <LittleFS.h>

// ---------- user config ----------
#define MFB_STANDALONE   1        // 1 = this sketch runs alone; 0 = when merged into gauge firmware
#define KL_RX_PIN        16
#define KL_TX_PIN        17
#define KL_INVERT        false    // true if your opto circuit inverts TX/RX
#define KL_ECHO          true     // single-wire K-line echoes TX bytes back
#define BLE_NAME         "MFB-PRO GAUGE"
#define FW_ID            "MFB-KLINE-BRIDGE v1.0"

#define NUS_SVC "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_RX  "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_TX  "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

enum { L_PING = 0x01, L_WAKE = 0x02, L_TXRX = 0x03, L_SENSE = 0x04,
       L_FBEGIN = 0x10, L_FCHUNK = 0x11, L_FEND = 0x12, L_FLIST = 0x13 };

HardwareSerial KL(2);
static BLECharacteristic *txChr = nullptr;
static volatile bool bleConn = false;
static uint16_t bleMtu = 23;

// ---------- RX ring for BLE (callback runs in BLE task, process in loop) ----------
static uint8_t ring[4096]; static volatile uint16_t rH = 0, rT = 0;
static void ringPut(const uint8_t *d, size_t n) { for (size_t i = 0; i < n; i++) { uint16_t nx = (rH + 1) % sizeof(ring); if (nx == rT) return; ring[rH] = d[i]; rH = nx; } }
static int ringGet() { if (rT == rH) return -1; uint8_t b = ring[rT]; rT = (rT + 1) % sizeof(ring); return b; }

// ---------- link frame parser (one per channel) ----------
struct Parser { uint8_t b[1100]; uint16_t n = 0; };
static Parser pUsb, pBle;
static bool busy = false;
bool mfbBridgeBusy() { return busy; }
__attribute__((weak)) void mfbOnFileReceived(const char *path, uint32_t size) { (void)path; (void)size; }

static void sendFrame(uint8_t ch, uint8_t type, const uint8_t *p, uint16_t n) {
  uint8_t h[5] = { 0x55, 0xAA, type, (uint8_t)(n & 0xFF), (uint8_t)(n >> 8) };
  uint8_t x = type ^ h[3] ^ h[4]; for (uint16_t i = 0; i < n; i++) x ^= p[i];
  if (ch == 0) { Serial.write(h, 5); if (n) Serial.write(p, n); Serial.write(x); return; }
  if (!bleConn || !txChr) return;
  static uint8_t out[1200]; uint16_t L = 0;
  memcpy(out, h, 5); L = 5; memcpy(out + L, p, n); L += n; out[L++] = x;
  uint16_t chunk = bleMtu > 23 ? bleMtu - 3 : 20; if (chunk > 180) chunk = 180;
  for (uint16_t o = 0; o < L; o += chunk) { uint16_t c = min<uint16_t>(chunk, L - o); txChr->setValue(out + o, c); txChr->notify(); delay(3); }
}
static void reply(uint8_t ch, uint8_t type, uint8_t st, const uint8_t *d = nullptr, uint16_t n = 0) {
  static uint8_t p[300]; p[0] = st; if (n) memcpy(p + 1, d, n); sendFrame(ch, type | 0x80, p, n + 1);
}

// ---------- K-line ----------
static void klBegin() { KL.begin(10400, SERIAL_8N1, KL_RX_PIN, KL_TX_PIN, KL_INVERT); KL.setTimeout(5); }
static void klWake() {
  KL.end();
  pinMode(KL_TX_PIN, OUTPUT);
  digitalWrite(KL_TX_PIN, KL_INVERT ? HIGH : LOW);  delay(70);   // bus LOW 70 ms
  digitalWrite(KL_TX_PIN, KL_INVERT ? LOW : HIGH);  delay(130);  // bus HIGH 130 ms
  klBegin();
  while (KL.available()) KL.read();
}
static bool klRead(uint8_t *dst, uint16_t n, uint32_t deadline) {
  uint16_t got = 0;
  while (got < n) { if (KL.available()) dst[got++] = KL.read(); else if ((int32_t)(millis() - deadline) > 0) return false; else delayMicroseconds(200); }
  return true;
}
// returns reply length or 0
static uint16_t klTxRx(const uint8_t *f, uint16_t n, uint8_t ml, uint16_t tmo, uint8_t *rx) {
  while (KL.available()) KL.read();
  KL.write(f, n); KL.flush();
  uint32_t dl = millis() + tmo + n * 2;
  if (KL_ECHO) { static uint8_t e[260]; if (!klRead(e, n, dl)) return 0; }
  if (!klRead(rx, ml + 1, dl)) return 0;
  uint8_t len = rx[ml]; if (len < ml + 2) return 0;
  if (!klRead(rx + ml + 1, len - ml - 1, dl)) return 0;
  return len;
}
static bool klSense() { KL.end(); pinMode(KL_RX_PIN, INPUT); delay(2); bool lvl = digitalRead(KL_RX_PIN); klBegin(); return KL_INVERT ? !lvl : lvl; }

// ---------- file receive ----------
static File fOut; static uint32_t fSize = 0, fGot = 0, fCrc = 0xFFFFFFFF; static char fPath[64];
static uint32_t crcUpd(uint32_t c, const uint8_t *d, uint16_t n) { for (uint16_t i = 0; i < n; i++) { c ^= d[i]; for (int k = 0; k < 8; k++) c = (c & 1) ? (c >> 1) ^ 0xEDB88320 : c >> 1; } return c; }

static void handle(uint8_t ch, uint8_t type, uint8_t *p, uint16_t n) {
  busy = true;
  switch (type) {
    case L_PING: reply(ch, type, 0, (const uint8_t *)FW_ID, strlen(FW_ID)); break;
    case L_WAKE: klWake(); reply(ch, type, 0); break;
    case L_SENSE: { uint8_t v = klSense(); reply(ch, type, 0, &v, 1); } break;
    case L_TXRX: {
      if (n < 4) { reply(ch, type, 2); break; }
      uint8_t ml = p[0]; uint16_t tmo = p[1] | (p[2] << 8); static uint8_t rx[260];
      uint16_t L = klTxRx(p + 3, n - 3, ml, tmo, rx);
      if (L) reply(ch, type, 0, rx, L); else reply(ch, type, 1);
    } break;
    case L_FBEGIN: {
      fSize = p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24);
      uint8_t nl = p[4]; char nm[48] = { 0 }; memcpy(nm, p + 5, min<uint8_t>(nl, 40));
      for (char *c = nm; *c; c++) if (*c == '/' || *c == '\\') *c = '_';
      if (!LittleFS.exists("/ecu")) LittleFS.mkdir("/ecu");
      snprintf(fPath, sizeof(fPath), "/ecu/%s.bin", nm);
      if (fOut) fOut.close();
      fOut = LittleFS.open(fPath, "w"); fGot = 0; fCrc = 0xFFFFFFFF;
      reply(ch, type, (fOut && LittleFS.totalBytes() - LittleFS.usedBytes() > fSize) ? 0 : 2);
    } break;
    case L_FCHUNK: {
      uint32_t off = p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24);
      if (!fOut) { reply(ch, type, 2); break; }
      if (off == fGot) { fOut.write(p + 4, n - 4); fCrc = crcUpd(fCrc, p + 4, n - 4); fGot += n - 4; reply(ch, type, 0); }
      else if (off < fGot) reply(ch, type, 0);   // duplicate (retry) — already stored
      else reply(ch, type, 2);
    } break;
    case L_FEND: {
      uint32_t c = p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24);
      if (fOut) fOut.close();
      bool ok = (fGot == fSize) && ((fCrc ^ 0xFFFFFFFF) == c);
      if (!ok) LittleFS.remove(fPath);
      reply(ch, type, ok ? 0 : 2);
      if (ok) mfbOnFileReceived(fPath, fSize);
    } break;
    case L_FLIST: {
      String s; File d = LittleFS.open("/ecu"); File f = d ? d.openNextFile() : File();
      while (f) { s += f.name(); s += ':'; s += f.size(); s += '\n'; f = d.openNextFile(); if (s.length() > 250) break; }
      reply(ch, type, 0, (const uint8_t *)s.c_str(), s.length());
    } break;
    default: reply(ch, type, 2);
  }
  busy = false;
}

static void feed(Parser &ps, uint8_t ch, uint8_t v) {
  if (ps.n == 0 && v != 0x55) return;
  if (ps.n == 1 && v != 0xAA) { ps.n = (v == 0x55); return; }
  if (ps.n >= sizeof(ps.b)) { ps.n = 0; return; }
  ps.b[ps.n++] = v;
  if (ps.n >= 6) {
    uint16_t L = ps.b[3] | (ps.b[4] << 8);
    if (L > sizeof(ps.b) - 6) { ps.n = 0; return; }
    if (ps.n == 6 + L) {
      uint8_t x = ps.b[2] ^ ps.b[3] ^ ps.b[4]; for (uint16_t i = 0; i < L; i++) x ^= ps.b[5 + i];
      if (x == ps.b[5 + L]) handle(ch, ps.b[2], ps.b + 5, L);
      ps.n = 0;
    }
  }
}

// ---------- BLE ----------
class SrvCB : public BLEServerCallbacks {
  void onConnect(BLEServer *s) override { bleConn = true; }
  void onDisconnect(BLEServer *s) override { bleConn = false; bleMtu = 23; s->getAdvertising()->start(); }
  void onMtuChanged(BLEServer *s, esp_ble_gatts_cb_param_t *param) override { bleMtu = param->mtu.mtu; }
};
class RxCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
    String v = c->getValue(); ringPut((const uint8_t *)v.c_str(), v.length());
#else
    std::string v = c->getValue(); ringPut((const uint8_t *)v.data(), v.size());
#endif
  }
};

void mfbBridgeBegin() {
  LittleFS.begin(true);
  klBegin();
  BLEDevice::init(BLE_NAME);
  BLEDevice::setMTU(247);
  BLEServer *srv = BLEDevice::createServer(); srv->setCallbacks(new SrvCB());
  BLEService *svc = srv->createService(NUS_SVC);
  txChr = svc->createCharacteristic(NUS_TX, BLECharacteristic::PROPERTY_NOTIFY); txChr->addDescriptor(new BLE2902());
  BLECharacteristic *rx = svc->createCharacteristic(NUS_RX, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCB());
  svc->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising(); adv->addServiceUUID(NUS_SVC); adv->setScanResponse(true); adv->start();
}
void mfbBridgeLoop() {
  while (Serial.available()) feed(pUsb, 0, Serial.read());
  int b; while ((b = ringGet()) >= 0) feed(pBle, 1, (uint8_t)b);
}

#if MFB_STANDALONE
void setup() { Serial.begin(115200); mfbBridgeBegin(); }
void loop() { mfbBridgeLoop(); delay(1); }
#endif
