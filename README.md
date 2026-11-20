# Jet Smart Gauge

> **อัปเดตล่าสุด:** เอาหน้า TUNE, ดูดไฟล์ และอัดไฟล์ออกแล้ว หน้าที่เหลือคือ Dash · Grid · Graph · AFR · Drag · DTC · Tools · Setup (ส่วนอธิบายหน้าที่ถูกเอาออกด้านล่างเป็นของเก่า)

โปรแกรมดูด/อัดไฟล์ ECU Honda (Keihin K-line) ธีมน้ำเงิน-ดำ เชื่อมกับ Smart Gauge ได้
เป็นไฟล์ HTML ไฟล์เดียว: `dist/Jet_Smart_Gauge.html` เปิดด้วย **Chrome / Edge** บนมือถือ Android หรือคอม

## เปิดใช้งาน
- Web Serial และ Web Bluetooth ต้องรันใน "secure context" ให้เปิดไฟล์ผ่าน `https://` (เช่น GitHub Pages / Netlify) หรือ `http://localhost`
  บนคอมจะเปิดแบบ `file://` ก็ใช้ได้
- โหมด **DEMO** ใช้กล่องจำลองที่ตอบเฟรมแบบเดียวกับกล่องจริง ใช้ลองได้ทุกฟังก์ชัน (ดูด อัด DTC EEPROM LIVE)

## ช่องทางเชื่อมต่อ
| ช่องทาง | ใช้อะไร | หมายเหตุ |
|---|---|---|
| สาย K-LINE USB | FTDI FT232R + วงจร K-line (L9637D / MC33290 / ออปโต้ PC817 x2) หรือสาย KKL | 10400 baud ปลุกกล่องด้วย BREAK 70ms ถ้าเป็น CH340 ให้เลือก "Low-baud" ในตั้งค่า |
| Smart Gauge (BLE / USB) | เกจ ESP32 ที่ลงเฟิร์มแวร์ `firmware/MFB_KLine_Bridge` แล้ว | เกจเป็นคนจับเวลา K-line ให้ ส่วนแอปส่งคำสั่งผ่าน MFB-LINK |
| เชื่อมเกจเพื่อส่งไฟล์อย่างเดียว | BLE | ส่ง .bin ไปเก็บใน `/ecu/<ชื่อ>.bin` ของเกจ แล้วกด FLASH ที่หน้าเกจ |

ปลั๊กเช็ค Honda 4 ขา (DLC): K-line / GND / +12V (สีสายต่างกันตามรุ่น ให้ดูคู่มือซ่อม) ถ้าต่อบนโต๊ะ ให้ใช้แหล่งจ่ายไฟอย่างน้อย 2.5A

## ฟังก์ชัน
- **ECU LIVE**: ตรวจสถานะกล่อง (OK / SECURE / READ / FLASH / RECOVER_OLD / RECOVER_NEW / OFF) อ่าน ECU ID กับ flash count
  ค่าสด RPM, TPS, MAP, ECT, IAT, BATT, SPD, INJ, IGN จากตาราง 0x11 และอ่านตารางดิบทั้งหมด
- **FLASH**
  - ดูด (Read): อ่านทีละ 12 byte (`82 82 00`) จนกล่องหยุดตอบ ทำให้รู้ขนาดจริงเอง
    ถ้าเลือกรุ่นเป็น AUTO โปรแกรมจะหา Start Offset ให้เอง (0 / 0x4000 / 0x8000 / 0x10000)
  - อัด (Write): เข้าโหมดแฟลช (`7D` PGM-FI / `7B` กู้) → erase (`7E 01 02…04`) → เขียนทีละ 128 byte
    (ถ้าไม่ผ่านจะลดเป็น 64) → post-write (`7E 01 08…0D`)
    โปรแกรมจะไม่ลบอะไรจนกว่าจะยืนยันได้ว่ากล่องอยู่ในโหมดแฟลชแล้ว
  - ตรวจและแก้ checksum (ผลรวมทั้งไฟล์ = 0x00 โดยปรับ byte ที่ตำแหน่ง checksum)
  - คลังไฟล์ในเครื่อง (IndexedDB) นำเข้า, บันทึก .bin, เปลี่ยนชื่อ, ลบ, ส่งไปเกจ
- **DTC**: อ่านโค้ดปัจจุบันและโค้ดที่เคยเกิด แล้วลบได้ (`72 74/73`, `72 60 03`)
- **EEPROM**: อ่าน เขียน ฟอร์แมต FF/00 (`82 82 10/14/18/19`)
- **HEX / COMPARE**: ดูไฟล์เป็น hex เทียบสองไฟล์ และกระโดดไปจุดที่ต่างกัน
- **SETTING**: ธีมสี 5 สี, วิธีปลุกกล่อง, timeout, เวลารอก่อนลบ, ขนาด block, รหัส Security Access, ฐานข้อมูลรุ่น (JSON แก้ได้)

## ฐานข้อมูลรุ่น — ควรอ่านก่อนใช้
- รุ่นที่มีเครื่องหมาย ✔ (MSX125, CRF110F, CBR250R, CBR300R HRC, CB500, CB650F, CBR600RR, CBR1000RR …)
  ใช้ค่า ขนาด / start / checksum จากตารางของโปรเจกต์ HondaECU
- รุ่นตลาดไทยที่มีเครื่องหมาย ⚠ (Wave, Click, PCX, ADV, Scoopy, CBR150R ฯลฯ) ใช้ **ค่าตั้งต้นของตระกูลกล่อง Keihin ขนาดเล็ก**
  (64KB, start 0x8000, checksum ที่ 0) ยังไม่ได้ยืนยันทีละรุ่น ให้ทำแบบนี้:
  **ดูดไฟล์เดิมก่อนเสมอ** ดูขนาดจริงกับ checksum แล้วค่อยแก้ค่าในตั้งค่าและบันทึก
- กล่องรุ่นใหม่บางรุ่นอาจขอรหัส Security Access หรือไม่รองรับคำสั่งชุดนี้ ถ้าดูดไม่ได้เลย แอปจะแจ้ง และกล่องจะไม่เสียหาย

## ความปลอดภัยตอนอัด
1. แบตต้องเต็ม หรือต่อชาร์จไว้
2. ดูดไฟล์เดิมของกล่องเก็บไว้ทุกครั้ง
3. ระหว่างอัด ห้ามปิดกุญแจ ห้ามถอดสาย และห้ามปิดแอป (แอปจะขอให้หน้าจอไม่ดับ)
4. ถ้าอัดค้างกลางทาง กล่องจะอยู่ในโหมด RECOVER ให้กดอัดซ้ำทันทีโดยไม่ปิดกุญแจ แอปจะใช้ลำดับคำสั่งกู้ให้เอง
5. อัดเสร็จแล้ว ปิดกุญแจ 10 วินาที แล้วค่อยเปิดใหม่

## เชื่อมกับ Smart Gauge (เฟิร์มแวร์ ESP32)
`firmware/MFB_KLine_Bridge/MFB_KLine_Bridge.ino`
- ถ้าจะรวมเข้ากับเฟิร์มแวร์เกจเดิม ให้ตั้ง `MFB_STANDALONE 0` แล้วเรียก `mfbBridgeBegin()` ใน setup() กับ `mfbBridgeLoop()` ใน loop()
- ช่วงที่ `mfbBridgeBusy()` เป็น true ให้หยุดการอ่าน K-line ของเกจเองไว้ก่อน
- เขียนฟังก์ชัน `mfbOnFileReceived(path, size)` เพื่อให้ไฟล์ที่ได้รับไปโผล่ในหน้า FLASH ของเกจ
- ขา K-line ตั้งค่าเริ่มต้นไว้ที่ RX=16 / TX=17 ถ้าวงจรออปโต้กลับขั้ว ให้ตั้ง `KL_INVERT true`
- BLE ใช้ Nordic UART Service ชื่อเครื่อง `MFB-PRO GAUGE`

### โปรโตคอล MFB-LINK (แอป ⇄ เกจ)
`55 AA | type | lenL lenH | payload | xor(type,len,payload)` — คำตอบคือ `type|0x80` และ payload[0] เป็นสถานะ (0 = OK, 1 = timeout, 2 = error)

| type | ชื่อ | payload ขาไป | payload ขากลับ |
|---|---|---|---|
| 01 | PING | – | สถานะ + ข้อความชื่อเฟิร์มแวร์ |
| 02 | WAKE | – | สถานะ (เกจดึง K-line ลง low 70ms แล้ว high 130ms) |
| 03 | TXRX | ml, timeoutL, timeoutH, เฟรม K-line | สถานะ + เฟรมตอบกลับ (ตัด echo ออกแล้ว) |
| 04 | SENSE | – | สถานะ + ระดับไฟ K-line |
| 10 | FILE_BEGIN | size u32, nameLen, name | สถานะ |
| 11 | FILE_CHUNK | offset u32, data (≤160) | สถานะ |
| 12 | FILE_END | crc32 u32 | สถานะ (0 = CRC ตรง) |
| 13 | FILE_LIST | – | สถานะ + "ชื่อ:ขนาด\n…" |

### เฟรม Honda K-line
`[mtype][len][data…][ck]` โดย len คือความยาวทั้งเฟรม และ ck คือ two's complement ของผลรวม (ทั้งเฟรมรวมกันต้องได้ 0)
ตัวอย่าง: ping `FE 04 72 8C` → `0E 04 72 7C`, ตาราง 11 `72 05 71 11 07`


## ฟังก์ชันจูน / เกจ (เพิ่มเติม)
| แท็บ | ทำอะไร | แหล่งข้อมูล |
|---|---|---|
| **Grid** | เกจ 12 ช่อง: TPS, W.TEMP, BATT, AFR, INJ, IGN, RPM, MAP, SPD, EOT, IAT, O2 | ECU (ตาราง 0x11) + เกจ (AFR/EOT/O2) |
| **Graph** | การ์ด RPM/TPS/GPS/AFR พร้อม min/max และกราฟเส้นย้อนหลัง 30 วินาที | ECU + เกจ |
| **Tune** | แก้ตารางแมพจากไฟล์ .bin ด้วย XDF: ตั้งค่า, ±, ±%, ×, เกลี่ย, ไล่ค่า, Undo/Redo, Copy/Paste, ดับเบิลแตะเพื่อใส่ค่า, มุมมอง 3D (ลากหมุน/บีบซูม), LIVE ชี้ช่องที่เครื่องวิ่งอยู่, ทับ AFR, FIT | ไฟล์ในคลัง + XDF |
| **AFR** | บันทึก AFR เฉลี่ยลงช่อง RPM×TPS (REC/ล้าง) แตะช่องเพื่อดู n/เฉลี่ย/min/max | AFR จากเกจ (wideband) |
| **Drag** | จับเวลา 201/402/500/1000 m, 0-100 km/h, ความเร็วสูงสุด, 3 รอบ | GPS เกจ (แนะนำ 10Hz) หรือ GPS มือถือ |
| **Tools** | EEPROM · Hex/เทียบไฟล์ · Log | — |

### Tune — ขั้นตอน
1. ดูดไฟล์ หรือนำเข้า .bin → แท็บ **Tune** → **ไฟล์ ▾** → เลือกไฟล์
2. **โหลด XDF** ของรุ่นนั้น (รองรับ XDF ของ TunerPro: XDFTABLE/XDFCONSTANT, 8/16/32-bit, signed, LSB-first, column-major, BASEOFFSET, สูตร MATH)
   ไม่มี XDF ให้ใช้ **กำหนดตารางเอง** (ใส่ address, ขนาด, ชนิด, สูตร, แกน)
3. แก้ค่า → **✅** บันทึกเป็นไฟล์ใหม่ (แก้ checksum ให้อัตโนมัติ) → แท็บ **อัดไฟล์** เพื่ออัดลงกล่อง
4. **FIT**: ใช้ AFR log ปรับตารางน้ำมัน `ค่าใหม่ = ค่าเดิม × AFR ที่วัดได้ / AFR เป้า` (เป้าเดินทาง/เต็มคันเร่ง และจำกัด ±% ต่อครั้งในตั้งค่า)
   ใช้เฉพาะช่องที่มีข้อมูล ≥ 3 ครั้ง — ใช้ได้กับตารางที่ค่ามากขึ้น = น้ำมันมากขึ้นเท่านั้น
   ถ้าไม่ได้เลือกช่องไว้ FIT จะใช้กับทั้งตาราง

> ตำแหน่งตารางในไฟล์ของแต่ละรุ่นต้องมาจาก XDF ที่ถูกต้อง โปรแกรมไม่เดา address ให้ ถ้าตารางเกินขนาดไฟล์ จะขึ้น ⚠ และไม่ยอมแก้

### คำสั่งเซ็นเซอร์เกจ (MFB-LINK 0x20 SENSORS)
คำตอบ: status + 18 byte (little-endian)
`afr u16 ×100 · gpsSpeed u16 ×10 (km/h) · sats u8 · satsInView u8 · lat i32 ×1e7 · lon i32 ×1e7 · eot+40 u8 · o2 u8 ×100 (V) · reserved · flags`
flags: bit0 AFR ถูกต้อง, bit1 GPS fix, bit2 EOT, bit3 O2
ในเฟิร์มแวร์เกจ ให้เขียนฟังก์ชัน `void mfbGetSensors(MfbSensors &s)` เติมค่าจากเซ็นเซอร์จริงของเกจ เกจรุ่นที่ยังไม่รองรับคำสั่งนี้ แอปจะหยุดถามเอง
แท็บ Drag จะเลือก GPS เกจก่อน ถ้าไม่มีจึงใช้ GPS มือถือ (~1Hz แม่นยำน้อยกว่า) เปลี่ยนได้ที่ปุ่ม "แหล่ง"

## แอป Android (APK)
โฟลเดอร์ `android/` เป็นแอป Android แบบ native ที่ห่อหน้าโปรแกรมเดียวกันไว้ข้างใน และมีตัวเชื่อม (JetBridge) ที่เขียนให้ใช้ฮาร์ดแวร์ได้จริง
- **USB OTG**: ใช้ไลบรารี usb-serial-for-android รองรับชิป FTDI, CH340/CH341/CH9102, CP210x, PL2303 และ ESP32 (CDC)
  ใช้คำสั่ง BREAK ปลุกกล่องได้ และตั้ง latency ของ FTDI เป็น 1ms เพื่อให้ดูด/อัดเร็วขึ้น
- **Bluetooth LE**: สแกนแล้วให้เลือกเกจจากรายการ (เกจที่มี ★ คือตัวที่มี MFB-LINK) ขอ MTU 247 และส่งข้อมูลแบบมีคิว
- **บันทึกไฟล์** ไปที่ `Download/JetHondaTune/` และเลือกไฟล์ .bin จากเครื่องได้
- ระหว่างอัดไฟล์ หน้าจอจะไม่ดับ จอเป็นแนวนอนเต็มจอ และปุ่มย้อนกลับจะปิดหน้าต่างหรือกลับหน้าแรก

### สร้าง APK ฟรีด้วย GitHub (ไม่ต้องลงโปรแกรมอะไร)
1. สร้าง repo ใหม่บน GitHub เช่น `JetHondaTune` แล้วอัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ ต้องมีโฟลเดอร์ `.github/workflows/` ไปด้วย
   ถ้าอัปโหลดผ่านเว็บแล้วโฟลเดอร์ `.github` ไม่ขึ้น ให้กด Add file → Create new file ตั้งชื่อ `.github/workflows/build-apk.yml`
   แล้ววางเนื้อหาจากไฟล์นั้นลงไป
2. เข้าแท็บ **Actions** → เลือก "Build Jet Smart Gauge APK" → กด **Run workflow** (ทุกครั้งที่ push ก็จะ build ให้เอง) ใช้เวลาราว 4–6 นาที
3. เข้าแท็บ **Releases** แล้วดาวน์โหลด `Jet_Smart_Gauge.apk` บนมือถือได้เลย
4. ติดตั้ง: อนุญาต "ติดตั้งแอปที่ไม่รู้จัก" ให้เบราว์เซอร์หรือแอปไฟล์ → เปิดแอป → อนุญาต "อุปกรณ์ใกล้เคียง/Bluetooth" ตอนเสียบสาย OTG
   จะมีหน้าต่างขออนุญาตใช้ USB ให้กดตกลง

### สร้างด้วย Android Studio
เปิดโฟลเดอร์ `android/` แล้วรัน `python3 build.py` ที่โฟลเดอร์หลักก่อน เพื่อคัดลอกหน้าเว็บไปไว้ใน assets จากนั้นกด Build → Build APK

APK เซ็นด้วยคีย์ `android/app/jet-release.jks` (รหัส `jethonda123`) ที่ใส่มาให้ในโปรเจกต์ ใช้คีย์เดิมทุกครั้ง จึงอัปเดตทับของเดิมได้โดยไม่ต้องถอนแอป
ถ้าจะเผยแพร่สู่สาธารณะ ควรสร้างคีย์ใหม่ของตัวเองและเก็บเป็นความลับ

**หมายเหตุ:** เกจ ESP32 ที่ต่อผ่านสาย USB บางบอร์ดจะรีเซ็ตตัวเองตอนเปิดพอร์ต แอปจึงตั้งค่า DTR/RTS เป็น low ให้แล้ว แต่ถ้ายังรีเซ็ต ให้ใช้ Bluetooth แทน

## โครงสร้างไฟล์
```
src/proto.js       เฟรม, checksum, MFB-LINK, DTC, ถอดค่า live, ฐานข้อมูลรุ่น
src/ecu.js         คำสั่ง ECU ทั้งหมด (detect / read / write / DTC / EEPROM / security)
src/sim.js         กล่องจำลองสำหรับ DEMO และชุดทดสอบ (มีแมพ น้ำมัน/ไฟจุด + เซ็นเซอร์ AFR/GPS จำลอง)
src/tune.js        XDF parser, อ่าน/เขียนตาราง, AFR log, FIT, ตัวจับเวลา Drag
src/ui-extra.js    หน้า Grid / Graph / Tune / AFR / Drag / Tools
src/transports.js  Web Serial (สาย USB) และ Smart Gauge (BLE / USB)
src/app.js, style.css, index.html   UI

build.py           รวมทุกไฟล์เป็น dist/Jet_Smart_Gauge.html
test/test.js       node test/test.js (ทดสอบทั้ง workflow กับกล่องจำลอง)
android/           แอป Android (MainActivity + JetBridge: USB OTG / BLE / บันทึกไฟล์)
.github/workflows/build-apk.yml   สร้าง APK อัตโนมัติบน GitHub
```

## ที่มาของโปรโตคอล
พอร์ตมาจากโปรเจกต์โอเพนซอร์ส GPL ได้แก่ eculib/HondaECU (RyanHope และ fork) และ TunerPro-HondaECU (AlexDev-TH)
รวมถึงบันทึก Honda_Keihin_KLine_Protocol ถ้าจะแจกจ่ายต่อ ควรใช้สัญญาอนุญาต GPL-3.0 ด้วย

## License (ต้องมี License ก่อนใช้งาน)
- เปิดแอปครั้งแรกจะเจอหน้าล็อก แสดง **รหัสเครื่อง** (เช่น `326E2-26C26`) → ส่งให้ร้านเพื่อขอ License → วางแล้วกด "เปิดใช้งาน"
- License ผูกกับเครื่องเดียว (Android ใช้ ANDROID_ID) ตรวจแบบออฟไลน์ด้วยลายเซ็น Ed25519 — ในแอปมีเฉพาะกุญแจสาธารณะ
- ออก License ด้วย `Jet_License_Generator_PRIVATE.html` (เก็บเฉพาะที่ร้าน) หรือ `python3 tools/license_issue.py --seed <ไฟล์กุญแจลับ> --device XXXXX-XXXXX --name ชื่อ --days 365`
- **ห้ามอัปกุญแจลับขึ้น GitHub / ห้ามแจกลูกค้า** · ถ้าลูกค้าล้างข้อมูลแอปบนเว็บ รหัสเครื่องอาจเปลี่ยน (บน APK ไม่เปลี่ยน)
- โหมด DEMO ถูกเอาออกจากตัวแอปแล้ว (เหลือเฉพาะใน `python3 build.py --dev` สำหรับทดสอบ ไม่ใช้แจก)

## เวอร์ชันและอัปเดต
- เลขเวอร์ชันอยู่ในไฟล์ `VERSION` (เช่น `1.1.0`) — ใช้ทั้งในแอป (Setup → เวอร์ชันและอัปเดต), versionName/versionCode ของ APK และชื่อ Release ใน GitHub (`v1.1.0`)
- ออกอัปเดต: แก้เลขใน `VERSION` → อัปโหลดขึ้น GitHub → Actions build → ได้ Release ใหม่พร้อม APK
- ในแอป: ใส่ `ชื่อ/โปรเจกต์` ของ GitHub แล้วกด "ตรวจสอบอัปเดต" → ถ้ามีเวอร์ชันใหม่จะมีปุ่มดาวน์โหลด APK (ติดตั้งทับของเดิมได้ License ยังอยู่) · เช็กอัตโนมัติวันละครั้งเมื่อตั้งค่าไว้

## v1.2.0 — OBD-II Bluetooth (ELM327)
- Setup → **ค้นหาบลูทูธ / Search Bluetooth** now lists paired devices + Classic discovery + BLE scan together, labelled **★ Smart Gauge**, **🚗 OBD** or other. Pick one and the app connects by type.
- **🚗 เชื่อม OBD-II (ELM327)** (Setup or Connect menu) supports the ELM327 Mini and clones: Bluetooth Classic SPP (pair in phone settings first, PIN `1234` or `0000`) and BLE UART (FFF0, FFE0, 18F0, ISSC, Nordic, or any notify+write service).
- `src/elm.js`: AT init, protocol auto-detect, supported-PID scan, multi-PID polling (petrol + diesel), battery via `ATRV`, DTC read (03/07) and clear (04). Values feed Dash/Grid/Graph/Logs; generic P/U-code descriptions added.
- ELM327 connects through the car's OBD port only (not the Honda K-line ECU tools).

## v1.3.0 — Honda Thailand models, faster live data, AFR/CRP log fix
- Setup → 🏍 **รุ่นรถ**: ~65 Honda models sold in Thailand (Wave/Dream/Cub, Click/PCX/ADV/Forza/Scoopy…, Monkey/MSX/Dax/CT125, CBR/CB, Rebel, CRF/Transalp/Africa Twin, Gold Wing). Sets gauge RPM scale and gear count; CVT models hide the gear box. Gear ratios are rough defaults — use **เรียนรู้เกียร์** (hold a gear 2 s) to learn the real ones.
- Live data: no pause between requests, gauge sensors polled on their own loop, ELM327 polls RPM/SPD/TPS/MAP every cycle and slower values less often, removed the per-segment glow filter and bar transitions (the main cause of lag on phones), Grid only repaints changed cells.
- Grid: **✔ เฉพาะค่าที่มี** (default) shows only values that actually arrive; derived values (load, lambda, baro, run time, distance) are filled in when the ECU doesn't provide them.
- Fixed: **CRP Log never recorded** (CRP volt was rejected by the AFR range filter). AFR Log verified.

## v1.3.1 — ELM327 / AFR Log
- ELM327: wide-band lambda (PID 24/34) → AFR, narrow-band O2 voltage (PID 14); on older ISO/KWP/J1850 cars one PID per request (auto-detected from the protocol, and adaptively if the car answers fewer PIDs than asked).
- AFR Log works from an ELM327 (RPM × throttle, or engine load when the car has no throttle PID). New orange status line on the AFR page says why it is not recording (not connected, no LIVE, no RPM, no AFR/lambda from the car, REC off).

## v1.3.2
- Version badge (e.g. `v1.3.3`) placed after "By เปรียวจูนเนอร์" in the header and on the licence screen.

## v1.5.0 — AFR over OBD-II, automatic Dash tiles, vehicle detection
- **AFR via OBD-II:** measured lambda (PID 24/34, second sensor 25/35) × the stoichiometric ratio of the fuel in use (petrol 14.7, diesel 14.5, LPG 15.5, CNG 17.2, ethanol 9.0 — from PID 51); if the car has no lambda PID, the ECU's commanded lambda (PID 44) is used and clearly labelled "ECU สั่ง" (a target, not a measurement). The source is shown on the AFR Log page and under the centre gauge. Same rule as the CAR gauge (PID 24, else 44).
- **Dash 6 tiles follow the car:** after connecting, only values the vehicle really reports are shown — petrol: coolant, oil/fuel trim, load, intake, battery, AFR; diesel: coolant, oil, load, EGT/rail pressure, battery, boost (ported from the CAR gauge `autoSlots()`). Battery voltage comes from the adapter (`ATRV`) when the car has no PID 42. Your own choice is remembered per profile (petrol / diesel / motorcycle); **Setup → "ช่องหน้าหลัก: ให้แอปเลือกอัตโนมัติ"** resets it. Tile picker lists the car's channels first and can use every OBD channel.
- **Vehicle detection:** reads the VIN (Mode 09) and ECU calibration id, decodes brand / country / model year (approx.) and, for Mazda Thailand, the model; fuel type (petrol/diesel/LPG/CNG/hybrid) from PID 51. A unique match sets scale, redline, tank automatically; otherwise the brand/fuel generic scale. Car catalogue (62 models: Toyota, Honda, Isuzu, Mitsubishi, Nissan, Mazda) taken from the CAR project. A model chosen by hand in Setup is not overridden.
- **Yamaha XMAX 300** 2017–2025 + Tech MAX / SP added to the model list (292 cc, 13 L / 13.2 L from 2023, CVT). Yamaha's ECU is neither OBD-II nor Honda K-line, so this only sets the model defaults (live values from the ECU are not available; GPS speed works). Redline is not published in the sources used, so no shift light is set (enter it in Setup).
- Tests: VIN (CAN multi-frame and ISO/KWP), EQR-only petrol, diesel keys; browser runs for petrol / EQR-only / diesel.

## v1.4.1
- **Shift light / redline:** the RPM arc turns red exactly from the redline of the selected bike (Setup → "รอบเรดไลน์"), and the RPM number blinks red from 95 % of the redline. Redline 0 = off (arc keeps the old colours).

## v1.4.0
- Data brought over from the user's own projects **JetOBD2HONDA** (Smart Gauge HONDA K-line + CAN) and **JetSmartGaugeCAR** (Smart Gauge CAR):
  - **HONDA-KLINE bridge** (ESP32 presenting itself as ELM327): recognised by name in the Bluetooth finder, protocol `H` detected (one PID per request, petrol), custom **PID D1 = injector pulse (ms)** read, Honda **blink-code DTCs** (`12-1`, `21-2` …) decoded from Mode 03/07 and cleared with Mode 04, shown with the Thai descriptions.
  - **Model data** for every Honda motorcycle from the gauge firmware: tank (L), redline (rpm), cylinders, injector flow (cc/min) and gearbox set → picking a model in Setup fills gauge scale, **gear ratios**, tank, injector flow and redline (all editable).
  - **Fuel rate / economy** derived from injector pulse × injector flow × injections (`FRATE` L/h, `KPL` km/L) when the bike has no fuel-rate PID.
  - New group **Honda cars (ELM327)** (City, Civic, Jazz, Brio, Mobilio, BR-V, HR-V, CR-V, Accord) with tank/redline from the CAR project; 36 more OBD-II fault codes with Thai text.
- Verified: table 0x11 layout in the app is identical to the bridge's (RPM, TPS, ECT, IAT, MAP, battery, speed, injector, ignition).
- Test: `HONDA-KLINE bridge tests passed` (node) + Playwright run with an emulated bridge.

## v1.3.3
- Version badge moved behind "By เปรียวจูนเนอร์".
