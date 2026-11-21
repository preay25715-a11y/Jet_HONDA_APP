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

## v1.6.1 — update test release
- No functional change: the version number only, to test the in-app update (v1.6.0 → v1.6.1, Setup → ตรวจสอบอัปเดต → อัปเดตเลย). The APK keeps the same package name and signing key, and its version code (10601) is higher than v1.6.0's (10600), so Android installs it over the old one with settings and licence kept.

## v1.6.0 — Setup → updates: the project address and links are no longer shown
- **Removed from Setup → "เวอร์ชันและอัปเดต":** the "ที่อยู่โปรเจกต์ GitHub" field. The section now shows only the installed version, the latest version, "ตรวจสอบอัปเดต" and "อัปเดตเลย". The update check itself is unchanged (the source is built into the app), and it still runs once a day after the licence is OK.
- **No address or link in any message:** the "no release in this project" message is now "ยังไม่มีข้อมูลเวอร์ชันล่าสุด"; network errors show only a short text (`HTTP nnn`, "เชื่อมต่อไม่ได้", "ดาวน์โหลดไม่สำเร็จ") instead of the raw error (which can contain a host name); when a new version has no APK file the project page is no longer opened as a fallback — the button stays hidden and the message says the file is not ready.
- **Saved settings:** the old stored project address (`updRepo`, `updRepoV`) is deleted from the phone's settings on first start.
- **Not a privacy measure for the repository itself:** the address is still inside the app code and the repository is still public; this only keeps it off the customer's screen. Making the repo private would stop the in-app update check (a private repo needs a login token).
- Tests: browser suite for the update section (no field, no address/`http`/GitHub text anywhere in Setup in every state: new version, 404, 500, no network, release without APK, install error), the node suite and the v1.5.7–v1.5.10 browser suites re-run unchanged.

## v1.5.10 — less lag: faster refresh of the live values
- **CAN / ELM327 / KONNWEI adapters:** a fast cycle is now **one** request carrying RPM, speed, throttle, MAP and lambda (up to 6 values per request); the slow values (coolant, intake temp, battery, fuel trim …) ride in a second request only every 2nd–4th cycle, depending on how fast the adapter answers (before: every cycle was 2 requests). Gentle mode (for fragile adapters) keeps the old, longer cycle.
- **Honda bridge, current firmware (one value per request):** the cycle is cut to 3–4 requests chosen from the adapter's response time; RPM and throttle every cycle, speed every 2nd cycle, the rest rotate.
- **Honda bridge with the multi-PID firmware:** the 4 fast values every cycle in 1–2 requests; slow values every 2nd–4th cycle.
- Simulator numbers (fixed 40 ms per request, **not a real adapter**): CAN 8.4 → 16.6 cycles/s at 40 ms, 6.2 → 9.2 at 80 ms; Honda bridge, one value per request: RPM/throttle 5.0 → 6.4 per second; Honda bridge, multi-value firmware: 12.4 → 16.6 per second. On a real adapter the gain depends on its response time and the bike/car ECU — **not verified on a real vehicle**. The big gain on a Honda needs the bridge firmware with multi-PID (`honda-bridge.bin`) flashed.
- Tests: node (requests per cycle and PIDs per cycle for CAN, Honda single/multi, gentle mode) + the browser suites from v1.5.7–v1.5.9 re-run unchanged.

## v1.5.9 — throttle starts at 0 %, faster Honda bridge readings
- **Throttle (TPS) 0–100 %:** the ECU reports the sensor itself (closed throttle ≈ 10–12 %). The app now learns the closed position — the lowest value that stays steady for 8 samples (jitter and one-sample glitches are ignored, a part-throttle hold never lowers it) — and shows **0.0 % with the throttle closed**, 100 % at full throttle, linear in between. Dash value, bar, AFR-log throttle columns and the logs all use the corrected value (`TPSraw` keeps the raw one).
- **Setup → TPS:** "ตั้ง 0% ตอนนี้" / "ตั้ง 100% ตอนนี้ (บิดสุด)" / "ล้างค่า TPS", with the raw value shown. The default 100 % point is raw 100 %; set it with the button if the bike's raw value at full throttle is lower. The calibration is kept per bike (same ECU-ID profile as v1.5.8). Cars keep their own throttle values.
- **Honda bridge, current firmware (one value per request):** RPM, throttle, MAP and speed are read in **every** cycle (before, throttle/speed took turns with other values); temperatures, injector, O2 and battery rotate in the remaining 1–2 slots.
- **Honda bridge, combined requests:** at connection the app asks `010C11`; a bridge that answers both values in one line is switched to combined mode automatically (all values in 1–2 requests per cycle instead of 5–6). The bridge firmware needs a small change for that (answer every PID of the request, up to 6) — until it is flashed nothing changes for the user.
- Tests: node (per-cycle PIDs, request count, multi-value bridge detection) + browser (zero learned from the live stream, steady/jitter/glitch rules, per-bike restore, manual buttons, cars untouched). **Not verified on a real bike.**

## v1.5.8 — no model picker: the app sets itself up from the bike
- **Removed:** the "เลือกรุ่นรถ" list in Setup. The ECU does not report a model name (neither the Honda K-line table nor OBD-II Mode 09 carries one for these bikes), so the app works from what the bike does send: its ECU ID (or the VIN's first 8 characters).
- **Per-bike profile:** gears (0 = auto/CVT), dial scale, redline, tank, injector flow and gear ratios are remembered for each bike's ID. Change them once in Setup (or learn the ratios) and they come back by themselves on the next connection; a second bike has its own set. Whatever was set in earlier versions (including a model chosen from the old list) moves to the first bike that connects.
- **Bike not known yet:** neutral profile — no gear display (the app does not guess a gear it cannot know), dial 12000 rpm that **widens by itself** when the needle stays at the end of the scale (5 samples in a row, up to 16000, remembered for the bike), shift light off until a redline is set.
- **Built-in table:** `HP.KNOWN_IDS` in `src/vehicle.js` (`'ECU:<id>'` / `'VIN:<8 chars>'` → model preset id) is still empty — there is no verified ID→model list for Thai-market bikes (the HondaECU table lists flash part numbers, not the ID the ECU sends on the K-line). A listed bike gets the whole preset (gears, ratios, dial, redline, tank, injectors) on connect with nothing to set. Fill it from real bikes: Setup → the 🔎 line (and the log line "รหัสรถ:") shows the ID.
- Cars are unchanged (VIN → model, fuel type, hybrid). The model presets (`BIKES`) stay in the app as the table's targets.
- Tests: fresh install, values set once come back, second bike neutral and independent, built-in table, owner numbers outrank the table, carried-over entry loses to a later table entry, OBD-II bike by VIN, dial widening (spike and short touch ignored). **Not verified on a real bike.**

## v1.5.7 — motorcycle model chosen automatically on connect
- **What the bike tells us:** a Honda motorcycle ECU does not report its model name. What can be read is the ECU's own ID (the Honda K-line / HONDA-KLINE bridge `0904`) or, on an OBD-II bike, the VIN (first 8 characters). The app uses that ID as the bike's identity.
- **Remembered per bike:** choose the model in Setup once; the app binds it (and the gear ratios you learned) to that ECU ID / VIN. Next time the same bike connects, the model and ratios are set by themselves, a different bike gets its own entry, and a correction made later only changes that bike. Choices made while disconnected are not bound to any bike.
- **Never-seen bike:** keeps the model already selected (so nothing changes for a single-bike owner) and remembers it for this ID; if no model is selected, Setup says the model is not known yet and shows the ECU ID / VIN. A model adopted this way never overrides a built-in table entry added later.
- **Built-in table:** `HP.KNOWN_IDS` in `src/vehicle.js` (`'ECU:<id>'` or `'VIN:<8 chars>'` → model id) is empty on purpose — there is no verified ID→model list yet and a wrong guess would set the wrong gear/RPM scale. It is filled from real bikes: send the ID shown in Setup (🔎 line / log "รหัสรถ:") together with the model name.
- The Setup 🔎 line and the log show the detected ECU ID / VIN and how the model was decided (remembered / built-in table / last selection / unknown). Car detection and the restore of the bike after a car are unchanged.
- Tests (simulated bridge + OBD-II bike): unknown → pick → reconnect restores it, second bike adopts then is corrected independently, learned gear ratios follow the bike, built-in table beats an adopted binding, no binding while disconnected. **Not verified on a real bike.**

## v1.5.6 — clearing trouble codes (DTC)
- **Clear (service 04):** the ELM327 is given a long reply window (ST FF ≈ 1 s, adaptive timing off) for reading and clearing codes and returns to the quick live timing afterwards — clearing can keep the ECU busy longer than the short live timeouts allowed (v1.5.1 tuning). After the clear the app waits ~0.8 s and re-reads the codes.
- **Honest result:** instead of a bare "ลบไม่สำเร็จ" the app says what happened — ECU refused (negative response 22: switch the engine off, key ON), not supported, no answer, adapter silent — or, when the ECU confirmed the clear but the code is back at the next read, that the fault is probably still present (e.g. P0118 with an unplugged / shorted coolant sensor is re-set at once). The raw ELM answers go to the log ("ลบโค้ด: ECU ตอบ …", "DTC ที่ ECU ตอบ …").
- **Reading codes (03/07):** on CAN the count byte after the mode decides how many codes there are (frames padded with zeros no longer produce phantom codes such as P1800 next to the real one), and multi-frame answers (several codes) are joined instead of dropped.
- Tests: padded frame, multi-frame with four codes, clear with timing set/restored, refusal reasons (22 / 11 / no data), sticky fault, K-line timing; UI check with the simulator. **Not verified on a real ECU** — if a code still will not clear, please send the two log lines mentioned above.

## v1.5.5 — fixed update source, one Bluetooth button
- **Update source locked:** the "ที่อยู่โปรเจกต์ GitHub" field in Setup is read-only and always `preay25715-a11y/Jet_HONDA_APP`; whatever an older version stored there is overwritten. The update check and the daily quiet check always use it.
- **Setup → Bluetooth:** the separate "เชื่อม OBD-II (ELM327)" button was removed. OBD-II adapters (ELM327, KONNWEI, HONDA-KLINE bridge) are connected from "ค้นหาบลูทูธ" (same picker as before, lists every kind of device) or from the status chip at the top.

## v1.5.4 — portrait + landscape, AFR log axes follow the engine
- **Screen rotation:** the Android app is no longer locked to landscape (`fullSensor`: follows how the phone is held, all four directions). Setup → "การหมุนจอ" can pin it to landscape or portrait instead (applied immediately, remembered). In portrait the Dash scrolls vertically and all seven tabs (including Setup) stay on screen; layouts were checked at 360×740, 390×844, 768×1024 and landscape 844×390, 915×412, 1024×768 with no horizontal overflow. Not yet tried on a real phone.
- **AFR log axes:** the RPM rows now run from idle (about 7 % of the top, at least 600 rpm) to the redline of the chosen vehicle (90 % of the dial when no redline is set), closer together at low rpm, and the throttle columns run 0–100 %. They follow Setup / vehicle detection; each axis set keeps its own log. **Note:** the table from earlier versions (fixed 840–9,800 rpm × 0–72) is no longer shown — its data stays stored but is not migrated.
- **Removed:** the Smart Gauge status box in Setup (status / name / channel / firmware / K-line / sensors) and the orange explanation bar on the AFR log page. The O2-estimate caveat remains on the Dash label ("AFR (O2 ประมาณ)") and in this README.

## v1.5.3 — link stability, AFR from the O2 sensor, clone-tolerant start-up
- **Info box:** the ⚡ diagnostics line was removed from Settings → OBD-II.
- **AFR from the O2 sensor:** when the car has no wideband lambda (PID 24/34), AFR is estimated from the narrowband O2 voltage (PID 14, 0–1.275 V) with a voltage → AFR table (0.1 V→17.0 · 0.2→15.5 · 0.45→14.7 · 0.8→13.5 · 0.9→12.0, scaled by the stoichiometric ratio of the fuel) and averaged over ~0.8 s because the sensor flips fast. The Dash tile says "AFR (O2 ประมาณ)" and the AFR help text explains it. **Honest limit:** a narrowband sensor is only accurate close to 14.7 — treat the number as a rich/lean indicator, not a measurement. Not offered for diesel. Source selector in Setup: auto / wideband (24·34) / O2 (14) / commanded (44).
- **Blue ELM327 MINI and other clones — start-up:** short gaps between the AT commands (clones lose commands when Bluetooth outruns the bus side); if `ATSP0` gives up ("UNABLE TO CONNECT") the protocols 6 / 5 / 3 / 4 / 8 are tried one by one and each attempt is logged; the error text now includes what the adapter really answered (`ELM ตอบ: …`); a start-up line in the log shows adapter version, protocol, count digit and AT2.
- **Link drops:** the reason is logged (adapter closed the link / read error / BLE status N) and the app reconnects by itself (5 tries). An adapter that dropped within the last 6 h is started in a gentler mode: level 1 = no count digit, no AT2; level 2 = one value per request with pauses and at most 2 requests per cycle. A user-initiated disconnect never reconnects. If the adapter is connected but nothing fresh arrives for 8 s, the old numbers are no longer shown as live.
- **Ideas ported from the JetSmartGaugeCAR firmware:** the protocol that worked last time is remembered per adapter and tried first (connects in about a second; a wrong memory falls back to the normal search); a PID the car never answers sits out for 30 cycles instead of costing a request slot every time; if a car answers only part of combined requests 6 times running, requests switch to one value each; CAN requests time out after 0.8 s (K-line 1.5 s, gentle modes 1.5 s) and K-line uses `ATST64` for slow ECUs; "not available" answers (all ones, e.g. 16383 rpm or lambda 1.99997) are dropped instead of shown; a pending request ends at once when the link is lost.
- **Not verified on real hardware.** Everything above is tested against the simulator only (FakeElm: multi-frame, protocol ladder, deaf/partial/junk PIDs, silent adapter, link loss, reconnect with escalating safe modes). The real cause of the blue adapter's drops is still unknown: after trying it, please send the log lines "OBD หลุดการเชื่อมต่อ — …", "อแดปเตอร์ … · โปรโตคอล …" and any "(ELM ตอบ: …)" text.

## v1.5.2 — update field
- The update field (Settings → อัปเดต) is pre-filled with `preay25715-a11y/Jet_HONDA_APP`. Whatever an older version had stored there (empty or mistyped) is replaced once on first launch; after that it can be edited. An empty field, or a pasted GitHub link, falls back to / is normalised to `owner/repo`. The once-a-day quiet update check therefore works out of the box.

## v1.5.1 — faster live data, KONNWEI adapters
- **Bug fixed — long CAN answers:** an ELM327 prints an answer longer than 7 bytes as a byte-count line plus numbered lines (`00B` / `0: …` / `1: …`). The driver dropped those lines, concluded the car "answered too few PIDs" and fell back to one PID per request (5–8x slower) on CAN cars. They are now joined into one message.
- **Response-count digit:** requests carry a trailing `1` (`010C0D111`), so the adapter returns as soon as the car has answered instead of waiting for its timeout. It is probed at connect time and dropped automatically (also in the middle of a session) if the adapter answers `?`. Not used with the HONDA-KLINE bridge.
- **Timing:** `ATAT2` (+ `ATST19` on CAN) is applied after the VIN is read, checked with real requests and reverted to `ATAT1`/`ATST32` when the adapter rejects it or the car stops answering. Live requests time out after 1.5 s instead of 2.5 s.
- **Rotating read queue:** RPM and AFR (PID 24/34, else 44) in every cycle; all other values rotate, so a cycle always takes the same time (the old "everything every 12th cycle" burst froze the display). The number of requests per cycle follows the adapter's measured speed. One-value-per-request cars: RPM + AFR every cycle, TPS / SPD alternate, the rest rotate.
- **KONNWEI KW902 / 903 / 905 / 906** (ELM327 v1.5 clones, some dual-mode BLE): the first `ATZ` is retried, unsupported tuning commands are tolerated, classic Bluetooth (SPP) is preferred for paired dual-mode adapters, and BLE connections ask for the high-priority connection interval. AFR works exactly as with any ELM327 (wideband lambda PID 24/34 or commanded lambda PID 44).
- **Info box (Settings → OBD-II):** measured refresh rate (cycles/s), one-value or multi-value mode, response-count and AT2 status, adapter id — handy for reporting results.
- Tests: multi-frame joining, count digit and its fallback (including mid-session), clone adapter profile, request budget per cycle (deterministic request counting, no timing), rotation coverage, Honda bridge untouched. Simulated benchmark (FakeElm with 30 ms bus + 40 ms ELM wait): CAN RPM/AFR 2.6 → 11 samples/s, worst cycle 1.06 s → 0.09 s; ISO/KWP at 90 ms/request: RPM 1.3 → 3.6, AFR 0.2 → 3.6 samples/s. **These are simulator numbers; not yet measured on a real adapter.**

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
