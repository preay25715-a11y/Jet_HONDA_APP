/* =====================================================================
 * Jet Smart Gauge — i18n.js : TH / EN switch (Thai is the source language)
 * Translates the DOM in place (text nodes + title/placeholder) and keeps
 * translating whatever the app writes afterwards.
 * ===================================================================== */
(function (root) {
  'use strict';
  // [Thai, English]  — long phrases are replaced anywhere inside a text,
  // short words (< 5 Thai chars) only when they are the whole text.
  const D = [
    ['กำลังเริ่มระบบ…', 'Starting…'], ['เชื่อมต่อ', 'Connect'], ['ย้อนหลัง 30 วินาที', 'Last 30 seconds'], ['⏸ หยุดกราฟ', '⏸ Pause graph'], ['▶ เดินกราฟ', '▶ Resume graph'],
    ['รีเซ็ต min/max', 'Reset min/max'], ['AFR LOG · เบนซิน', 'AFR LOG · Gasoline'], ['CRP LOG · ดีเซล', 'CRP LOG · Diesel'], ['⛽ เบนซิน', '⛽ Gasoline'], ['🛢 ดีเซล', '🛢 Diesel'],
    ['ล้าง', 'Clear'], ['11.5 หนา · 14.7 · 16.5 บาง', '11.5 rich · 14.7 · 16.5 lean'], ['0 V ต่ำ · 2.5 V · 5 V สูง', '0 V low · 2.5 V · 5 V high'],
    ['ช่องมืด = ยังไม่มีข้อมูล · กรอบขาว = ตำแหน่งเครื่องตอนนี้ · แตะช่อง = ดูรายละเอียด', 'Dark cell = no data · white box = current engine position · tap a cell for details'],
    ['แหล่ง: AUTO', 'Source: AUTO'], ['แหล่ง: เกจ', 'Source: Gauge'], ['แหล่ง: มือถือ', 'Source: Phone'], ['แหล่ง GPS', 'GPS source'],
    ['โค้ดปัญหา (DTC)', 'Diagnostic trouble codes (DTC)'], ['ปัจจุบัน', 'Current'], ['ที่เคยเกิด', 'History'], ['ลบโค้ด', 'Clear codes'], ['อ่านโค้ด', 'Read codes'], ['กด "อ่านโค้ด"', 'Press "Read codes"'],
    ['อ่านโค้ด DTC', 'Read DTC'], ['ไม่มีโค้ด ✔', 'No codes ✔'], ['ลบโค้ดทั้งหมดในกล่อง?', 'Clear all codes in the ECU?'], ['ลบโค้ดแล้ว', 'Codes cleared'], ['ลบไม่สำเร็จ', 'Clear failed'],
    ['ทั้งหมด / ALL', 'ALL'], ['SETTING', 'SETTINGS'], ['ภาษา / Language', 'Language'],
    ['ค้นหา Bluetooth', 'Search Bluetooth'], ['📶 ค้นหา Bluetooth', '📶 Search Bluetooth'], ['ตัดการเชื่อมต่อ', 'Disconnect'], ['ปิด', 'Close'], ['คืนค่าเริ่มต้น', 'Reset to default'], ['บันทึก', 'Save'], ['💾 บันทึก', '💾 Save'],
    ['Hex / เทียบไฟล์', 'Hex / compare'], ['⬇ อ่าน EEPROM', '⬇ Read EEPROM'], ['⚡ เขียนจากไฟล์', '⚡ Write from file'], ['ฟอร์แมต FF', 'Format FF'], ['ฟอร์แมต 00', 'Format 00'],
    ['EEPROM เก็บค่าเรียนรู้/เลขไมล์บางรุ่น — อ่านเก็บไว้ก่อนเขียนหรือฟอร์แมตทุกครั้ง', 'EEPROM holds learned values / odometer on some models — always read and keep a copy before writing or formatting'],
    ['ยังไม่มีข้อมูล', 'No data yet'], ['ไฟล์ A', 'File A'], ['เทียบกับ B', 'Compare with B'], ['ไปที่ (hex)', 'Go to (hex)'], ['ไปจุดต่างถัดไป', 'Next difference'], ['แสดงเฟรม TX/RX', 'Show TX/RX frames'], ['บันทึก log', 'Save log'],
    ['เลือกค่าที่แสดง', 'Choose value'], ['เลือกค่าที่ช่องนี้', 'Choose value for this tile'], ['ยกเลิก', 'Cancel'], ['ตกลง', 'OK'], ['ยืนยัน', 'Confirm'], ['บันทึกแล้ว:', 'Saved:'], ['บันทึกแล้ว', 'Saved'], ['บันทึกไฟล์ไม่สำเร็จ', 'Could not save file'],
    ['OFFLINE · แตะเพื่อเชื่อมต่อ', 'OFFLINE · tap to connect'], ['DEMO (จำลอง)', 'DEMO (simulated)'], ['สาย USB', 'USB cable'], ['สถานะ', 'Status'], ['เชื่อมแล้ว', 'Connected'], ['ยังไม่เชื่อม', 'Not connected'],
    ['ชื่อ', 'Name'], ['ช่องทาง', 'Channel'], ['เฟิร์มแวร์', 'Firmware'], ['เป็นตัวต่อ K-line', 'K-line adapter'], ['ใช่', 'Yes'], ['ไม่', 'No'], ['เซ็นเซอร์', 'Sensors'], ['เฟิร์มแวร์ไม่รองรับ', 'Firmware not supported'], ['รอข้อมูล…', 'Waiting for data…'],
    ['ตัดการเชื่อมต่อเกจแล้ว', 'Gauge disconnected'], ['มือถือมีพอร์ต USB เดียว (ใช้กับสาย K-line อยู่) — ต่อเกจด้วย Bluetooth แทน', 'The phone has a single USB port (in use for the K-line cable) — connect the gauge by Bluetooth instead'],
    ['เกจหลุดการเชื่อมต่อ', 'Gauge connection lost'], ['เชื่อมเกจแล้ว', 'Gauge connected'], ['เบราว์เซอร์นี้ไม่รองรับ Web Serial — ใช้ Chrome/Edge หรือแอป APK', 'This browser has no Web Serial — use Chrome/Edge or the APK app'],
    ['การเชื่อมต่อหลุด', 'Connection lost'], ['ยังไม่ได้เชื่อมต่อ', 'Not connected'], ['กำลังทำงานอื่นอยู่', 'Another job is running'], ['ยกเลิกแล้ว', 'Cancelled'], ['ตรวจกล่อง', 'Detect ECU'], ['สถานะกล่อง:', 'ECU status:'],
    ['ยังไม่มีค่า AFR — ต้องต่อ Smart Gauge ที่มีไวด์แบนด์ (หรือเปิด DEMO)', 'No AFR value — connect a Smart Gauge with a wideband sensor (or turn on DEMO)'],
    ['ยังไม่มีค่า CRP — ต้องต่อ Smart Gauge ที่มีเซ็นเซอร์ CRP (หรือเปิด DEMO)', 'No CRP value — connect a Smart Gauge with a CRP sensor (or turn on DEMO)'],
    ['LIVE: กล่องไม่ตอบ', 'LIVE: ECU not responding'], ['อ่าน EEPROM', 'Read EEPROM'], ['ไฟล์ EEPROM ต้อง 256 หรือ 512 byte', 'EEPROM file must be 256 or 512 bytes'], ['เขียน EEPROM จากไฟล์', 'Write EEPROM from file'],
    ['เขียน EEPROM สำเร็จ', 'EEPROM written'], ['เขียน EEPROM', 'Write EEPROM'], ['ฟอร์แมต EEPROM เป็น', 'Format EEPROM to'], ['? ข้อมูลเดิมจะหายทั้งหมด', '? All existing data will be lost'], ['ฟอร์แมต EEPROM', 'Format EEPROM'],
    ['ฟอร์แมตแล้ว', 'Formatted'], ['ไม่สำเร็จ', 'failed'], ['เลือกไฟล์ A และ B', 'Choose files A and B'], ['เลือกไฟล์ A', 'Choose file A'], ['ต่างกัน', 'differ'], ['byte ใน', 'bytes in'], ['ช่วง', 'ranges'],
    ['ขนาดไม่เท่ากัน', 'Different sizes'], ['ไม่มีจุดต่าง', 'No differences'], ['ผิดพลาด:', 'Error:'], ['คืนค่าตั้งค่าทั้งหมด?', 'Reset all settings?'],
    ['โหลดธีมและหน้าจอ…', 'Loading theme and screens…'], ['เปิดคลังไฟล์ ECU…', 'Opening ECU file store…'], ['เปิดคลังไฟล์ไม่ได้:', 'Cannot open file store:'], ['เตรียมโปรโตคอล K-LINE…', 'Preparing K-LINE protocol…'],
    ['พร้อม · USB OTG + Bluetooth', 'Ready · USB OTG + Bluetooth'], ['พร้อมใช้งาน', 'Ready'], ['มี', 'Yes'], ['ไม่มี', 'No'], ['GPS ไม่พร้อม', 'GPS not ready'], ['เกจ', 'Gauge'], ['มือถือ', 'Phone'],
    ['ยังไม่มีข้อมูลสด — กด LIVE หรือเปิด DEMO', 'No live data yet — press LIVE or turn on DEMO'], ['ค่าเริ่มต้น (RPM × TPS)', 'Default (RPM × TPS)'], ['ค่าเริ่มต้น', 'Default'],
    ['แกนจาก', 'axes from'], ['บันทึกแล้ว', 'logged'], ['ช่อง', 'cells'], ['สด', 'live'], ['ยังไม่มีข้อมูลสด (ต่อเกจ/เปิด DEMO)', 'no live data (connect gauge / DEMO)'],
    ['เฉลี่ย', 'avg'], ['ครั้ง', 'samples'], ['ยังไม่มีข้อมูล', 'no data yet'], ['Log ทั้งหมด?', 'Log?'], ['ล้าง ', 'Clear '], ['จบรอบ:', 'Run finished:'], ['หยุด LOG แล้ว', 'Log stopped'],
    ['พร้อมจับเวลา — ออกตัวได้เลย', 'Ready — launch when you like'], ['ล้างผลทั้ง 3 รอบ?', 'Clear all 3 runs?'], ['ยังไม่มีสัญญาณ GPS', 'No GPS signal'], ['ครั้ง/วินาที', 'per second'],
    ['GPS มือถือ', 'Phone GPS'], ['AFR เป้า (เดินทาง)', 'Target AFR (cruise)'], ['AFR เป้า (เต็มคันเร่ง)', 'Target AFR (full throttle)'], ['เต็มคันเร่งเมื่อ TPS ≥ (%)', 'Full throttle when TPS ≥ (%)'],
    ['AUTO (เกจก่อน)', 'AUTO (gauge first)'], ['เกจเท่านั้น', 'Gauge only'], ['มือถือเท่านั้น', 'Phone only'],
    ['hex ต้องเป็นจำนวนคู่', 'hex must have an even number of digits'], ['ไม่พบกล่อง (บิดกุญแจ ON?)', 'ECU not found (key ON?)'], ['ไม่ทราบสถานะ', 'Unknown state'], ['ปกติ (พร้อมใช้งาน)', 'Normal (ready)'],
    ['ปลดล็อกแล้ว (อ่านได้)', 'Unlocked (readable)'], ['โหมดอ่าน', 'Read mode'], ['โหมดกู้ (แฟลชค้าง-แบบเก่า)', 'Recovery mode (stuck flash, old type)'], ['โหมดกู้ (แฟลชค้าง-แบบใหม่)', 'Recovery mode (stuck flash, new type)'],
    ['โหมดแฟลช (บูตโหลดเดอร์)', 'Flash mode (bootloader)'], ['ผิดพลาด', 'Error'],
    ['sensor แรงดันต่ำ', 'sensor voltage low'], ['sensor แรงดันสูง', 'sensor voltage high'], ['แรงดันต่ำ', 'voltage low'], ['แรงดันสูง', 'voltage high'], ['หัวฉีด (สูบ 1)', 'Injector (cyl. 1)'], ['หัวฉีด (สูบ 2)', 'Injector (cyl. 2)'],
    ['EEPROM ใน ECU', 'ECU EEPROM'], ['ไม่มีคำอธิบายในฐานข้อมูล (ดูคู่มือซ่อมรุ่นนั้น)', 'No description in database (see the workshop manual)'],
    ['เชื่อมต่อ Bluetooth ไม่สำเร็จ', 'Bluetooth connection failed'], ['Bluetooth ยังไม่พร้อม', 'Bluetooth not ready'], ['เปิด USB ไม่สำเร็จ (หมดเวลา)', 'Could not open USB (timeout)'], ['เขียน USB ไม่ได้', 'USB write failed'],
    ['เบราว์เซอร์นี้ไม่รองรับ Bluetooth (ใช้ Chrome บน Android / PC)', 'This browser has no Bluetooth support (use Chrome on Android / PC)'], ['ยกเลิกโดยผู้ใช้', 'Cancelled by user'],
    ['เชื่อมต่อได้แต่เกจไม่ตอบ (อัปเดตเฟิร์มแวร์เกจเป็น bridge v1)', 'Connected but the gauge does not answer (update gauge firmware to bridge v1)'], ['(อัปเดตเฟิร์มแวร์เกจ)', '(update gauge firmware)'],
    ['สาย K-LINE USB (FTDI / CH340 / KKL)', 'K-LINE USB cable (FTDI / CH340 / KKL)'], ['ต่อมือถือ OTG หรือคอม · Chrome รองรับ Web Serial', 'Phone OTG or PC · Chrome supports Web Serial'],
    ['ตรวจสถานะกล่อง…', 'Checking ECU state…'], ['ติดต่อกล่องไม่ได้', 'Cannot reach ECU'],
    ['เกจทำหน้าที่เป็นตัวต่อ K-line + รับไฟล์ไปแฟลชเอง', 'The gauge acts as the K-line adapter + receives files to flash by itself'], ['Smart Gauge ผ่าน Bluetooth', 'Smart Gauge via Bluetooth'], ['Smart Gauge ผ่านสาย USB', 'Smart Gauge via USB cable'],
    ['เหมือน Bluetooth แต่เร็วกว่า', 'Like Bluetooth but faster'], ['เชื่อมเกจเพื่อส่งไฟล์อย่างเดียว (Bluetooth)', 'Connect gauge for file transfer only (Bluetooth)'], ['ใช้คู่กับสาย USB ได้', 'Can be used together with a USB cable'],
    ['DEMO (กล่องจำลอง)', 'DEMO (simulated ECU)'], ['ทดลองทุกฟังก์ชันโดยไม่ต้องต่อรถ', 'Try every function without a vehicle'], ['GPS เกจ', 'GPS Gauge'], ['GPS มือถือ', 'GPS Phone'], ['Jet Smart Gauge (จำลอง)', 'Jet Smart Gauge (simulated)'],
    ['พร้อมใช้งาน · Web Serial:', 'Ready · Web Serial:'], ['Jet Smart Gauge (Android APP) พร้อมใช้งาน', 'Jet Smart Gauge (Android APP) ready'],
    ['🚗 เชื่อม OBD-II (ELM327)', '🚗 Connect OBD-II (ELM327)'], ['OBD-II Bluetooth (ELM327 Mini และรุ่นอื่น)', 'OBD-II Bluetooth (ELM327 Mini & others)'],
    ['เสียบช่อง OBD ของรถ · จับคู่ PIN 1234 หรือ 0000 · ดูค่าสด + DTC', 'Plug into the car OBD port · pair with PIN 1234 or 0000 · live data + DTC'],
    ['🚗 OBD-II: ยังไม่เชื่อม', '🚗 OBD-II: not connected'], ['🚗 OBD-II:', '🚗 OBD-II:'], ['ดีเซล', 'Diesel'], ['เบนซิน', 'Petrol'],
    ['เลือกอุปกรณ์ Bluetooth…', 'Choose a Bluetooth device…'], ['เชื่อม OBD-II แล้ว', 'OBD-II connected'], ['ตัดการเชื่อมต่อ OBD แล้ว', 'OBD disconnected'],
    ['OBD หลุดการเชื่อมต่อ', 'OBD connection lost'], ['เชื่อม ELM327 ได้เฉพาะในแอป Android', 'ELM327 works only in the Android app'],
    ['🏍🚗 รถ', '🏍🚗 Vehicle'], ['ต่อรถแล้วแอปจะอ่านรหัสรถและตั้งค่าให้เอง (ค่าด้านล่างปรับเองได้ แอปจำไว้ให้รถแต่ละคัน)', 'Connect to the vehicle and the app reads its ID and sets itself up (the values below can be changed; the app remembers them per vehicle)'],
    ['🏍 รุ่นรถ', '🏍 Vehicle'], ['เลือกรุ่น Honda', 'Choose Honda model'], ['— เลือกรุ่น —', '— choose model —'], ['รถครอบครัว / Cub', 'Family / Cub'], ['สกู๊ตเตอร์ (CVT)', 'Scooters (CVT)'],
    ['มินิไบค์ / Retro', 'Mini / Retro'], ['สปอร์ต / เนคเก็ต', 'Sport / Naked'], ['ครุยเซอร์ / คลาสสิก', 'Cruiser / Classic'], ['ผจญภัย / ออฟโรด', 'Adventure / Off-road'], ['ทัวร์ริ่ง', 'Touring'],
    ['กำหนดเอง (รุ่นอื่น)', 'Custom (other model)'], ['จำนวนเกียร์ (0 = ออโต้/CVT)', 'Gears (0 = auto/CVT)'], ['RPM เต็มสเกลหน้าปัด', 'Gauge full-scale RPM'], ['อัตราส่วนเกียร์ (rpm ต่อ km/h)', 'Gear ratios (rpm per km/h)'],
    ['เรียนรู้เกียร์:', 'Learn gear:'], ['บันทึกเกียร์นี้ (ขับค้างเกียร์ไว้ 2 วิ)', 'Save this gear (hold the gear 2 s while riding)'], ['✔ เฉพาะค่าที่มี', '✔ Only values with data'],
    ['ยังไม่มีค่าเข้ามา — เชื่อมต่อแล้วค่าจะโผล่ที่นี่เอง (กด “เฉพาะค่าที่มี” เพื่อดูทุกช่อง)', 'No data yet — values appear here once connected (tap “Only values with data” to see every cell)'],
    ['ตั้งค่า', 'SETTINGS'], ['ภาษา', 'Language'], ['ค้นหาบลูทูธ', 'Search Bluetooth'], ['📶 ค้นหาบลูทูธ', '📶 Search Bluetooth'], ['ค่า AFR และจีพีเอส', 'AFR & GPS'],
    ['เป้า AFR (ขับปกติ)', 'Target AFR (cruise)'], ['เป้า AFR (เปิดคันเร่งเต็ม)', 'Target AFR (full throttle)'], ['ถือว่าเปิดเต็มเมื่อคันเร่ง ≥ (%)', 'Full throttle when pedal ≥ (%)'],
    ['แหล่งสัญญาณจีพีเอส', 'GPS source'], ['อัตโนมัติ (เกจก่อน)', 'AUTO (gauge first)'], ['โหมดสาธิต (จำลอง)', 'DEMO (simulated)'], ['ใช้เป็นตัวต่อสาย K-line', 'Used as K-line adapter'], ['การหมุนจอ', 'Screen rotation'], ['อัตโนมัติ (ตามที่ถือมือถือ)', 'Auto (follows how you hold the phone)'], ['แนวนอน', 'Landscape'], ['แนวตั้ง', 'Portrait'],
    ['ไวด์แบนด์', 'Wideband'], ['จีพีเอส', 'GPS'], ['อุณหภูมิน้ำมันเครื่อง', 'Oil temp'], ['ออกซิเจน', 'O2'],
    ['ต้องมี License ก่อนใช้งาน — ส่ง “รหัสเครื่อง” ให้ เปรียวจูนเนอร์ เพื่อขอ License', 'A licence is required — send the “Device ID” to เปรียวจูนเนอร์ to get your licence'],
    ['วาง License ที่ได้รับที่นี่', 'Paste your licence here'], ['คัดลอกแล้ว ✓', 'Copied ✓'], ['คัดลอก', 'Copy'], ['วาง', 'Paste'], ['เปิดใช้งาน', 'Activate'],
    ['รูปแบบ License ไม่ถูกต้อง — คัดลอกให้ครบทุกตัวอักษร', 'Invalid licence format — copy every character'], ['License ไม่ถูกต้อง', 'Invalid licence'],
    ['License นี้ออกให้เครื่องอื่น (รหัสเครื่องไม่ตรง)', 'This licence was issued for another device (ID mismatch)'], ['License หมดอายุแล้ว — ติดต่อ เปรียวจูนเนอร์ เพื่อต่ออายุ', 'Licence expired — contact เปรียวจูนเนอร์ to renew'],
    ['นาฬิกาเครื่องผิดปกติ — ตั้งวันเวลาให้ถูกต้องแล้วลองใหม่', 'Device clock looks wrong — set the correct date/time and try again'], ['เปิดใช้งานสำเร็จ — สวัสดี', 'Activated — welcome'],
    ['เจ้าของ', 'Owner'], ['รหัสเครื่อง', 'Device ID'], ['หมดอายุ', 'Expires'], ['ถาวร', 'Lifetime'],
    ['⬆ เวอร์ชันและอัปเดต', '⬆ Version & updates'], ['เวอร์ชันที่ใช้', 'Installed version'], ['เวอร์ชันล่าสุด', 'Latest version'],
    ['🔄 ตรวจสอบอัปเดต', '🔄 Check for update'], ['⬇ อัปเดตเลย', '⬇ Update now'],
    ['กำลังตรวจสอบ…', 'Checking…'], ['ยังไม่มีข้อมูลเวอร์ชันล่าสุด', 'No version information yet'], ['ชนิดรถ (ใช้เมื่อแอปแยกเองไม่ได้)', 'Vehicle type (when the app cannot tell)'], ['มอเตอร์ไซค์ (ตั้งชนิดรถไว้เอง)', 'Motorcycle (type set in Setup)'], ['Honda มอเตอร์ไซค์ (กล่อง HONDA-KLINE)', 'Honda motorcycle (HONDA-KLINE box)'], ['— มีผลตอนเชื่อมต่อครั้งถัดไป', '— applies at the next connection'], ['ชนิดรถ:', 'Vehicle type:'], ['แต่ไฟล์อัปเดตยังไม่พร้อม — ลองใหม่ภายหลัง', 'but the update file is not ready — try again later'], ['ดาวน์โหลดไม่สำเร็จ', 'Download failed'], ['เชื่อมต่อไม่ได้', 'Cannot connect'], ['มีเวอร์ชันใหม่', 'New version'], ['— กดดาวน์โหลดแล้วติดตั้งทับของเดิม', '— tap download and install over the old one'],
    ['(ดูที่ Setup)', '(see Setup)'], ['ใช้เวอร์ชันล่าสุดอยู่แล้ว ✓', 'You are on the latest version ✓'], ['ตรวจสอบไม่สำเร็จ:', 'Check failed:'], ['(ต้องมีอินเทอร์เน็ต)', '(internet required)'],
    ['กำลังดาวน์โหลด…', 'Downloading…'], ['ดาวน์โหลดเสร็จ — กด “ติดตั้ง” ในหน้าต่างที่เด้งขึ้นมา', 'Download complete — tap “Install” in the window that pops up'],
    ['อนุญาต “ติดตั้งแอปที่ไม่รู้จัก” ให้แอปนี้ในหน้าตั้งค่า แล้วกลับมากดอัปเดตอีกครั้ง', 'Allow “Install unknown apps” for this app in the settings page, then come back and tap update again'],
    ['อัปเดตไม่สำเร็จ:', 'Update failed:'], ['— ลองกดอีกครั้ง', '— try again'], ['— กดดาวน์โหลดแล้วติดตั้งทับของเดิม', '— tap “Update now”'],
    ['ขนาด', 'size'], ['ไม่ตรง', 'mismatch'],
    ['📡 ค้นหา WiFi OBD2', '📡 Search WiFi OBD2'], ['ค้นหา WiFi OBD2', 'Search WiFi OBD2'], ['🔄 ค้นหาใหม่', '🔄 Search again'], ['✎ ใส่ IP เอง', '✎ Enter IP manually'], ['⚙ ตั้งค่า WiFi', '⚙ WiFi settings'], ['กำลังค้นหาอแดปเตอร์…', 'Searching for adapters…'], ['WiFi ในมือถือปิดอยู่ — เปิด WiFi แล้วต่อกับ WiFi ของอแดปเตอร์ (ชื่อมักเป็น WiFi_OBDII / OBDII / V-LINK) แล้วกด “ค้นหาใหม่”', 'Phone WiFi is off — turn it on, join the adapter\'s WiFi (usually named WiFi_OBDII / OBDII / V-LINK), then tap “Search again”'], ['— พบอแดปเตอร์ ', '— adapters found: '], [' ตัว เลือกเพื่อเชื่อมต่อ', ' · pick one to connect'], ['— ไม่พบอแดปเตอร์ — ถ้านี่ไม่ใช่ WiFi ของอแดปเตอร์ ให้ต่อ WiFi ของอแดปเตอร์ก่อน (ปิดอแดปเตอร์แล้วเสียบใหม่ถ้าไม่เห็นชื่อ) หรือกด “ใส่ IP เอง”', '— no adapter found. If this is not the adapter\'s WiFi, join the adapter\'s WiFi first (re-plug the adapter if you can\'t see its name) or tap “Enter IP manually”'], ['มือถือยังไม่ได้ต่อ WiFi — เลือกชื่อ WiFi ของอแดปเตอร์ด้านล่าง หรือกด “ตั้งค่า WiFi” แล้วต่อเอง', 'The phone is not on WiFi — pick the adapter\'s WiFi below or tap “WiFi settings” and join it yourself'], ['🚗 พบอแดปเตอร์ ELM327', '🚗 ELM327 adapter found'], ['❔ มีอุปกรณ์ตอบที่พอร์ตนี้', '❔ A device answers on this port'], ['แตะเพื่อเชื่อมต่อ', 'Tap to connect'], ['ไม่ยืนยันว่าเป็น ELM327 — แตะเพื่อลองเชื่อมต่อ', 'Not confirmed as ELM327 — tap to try'], ['ไม่มีรหัสผ่าน', 'Open network'], ['มีรหัสผ่าน', 'Password protected'], [' · แตะเพื่อต่อ WiFi นี้', ' · tap to join this WiFi'], ['📍 ยังไม่อนุญาต “ตำแหน่ง” ให้แอป', '📍 Location permission not granted'], ['อนุญาตแล้วแอปจะแสดงรายชื่อ WiFi รอบตัวให้เลือก (หรือต่อ WiFi เองในตั้งค่า WiFi) — แตะเพื่อเปิดตั้งค่าแอป', 'Grant it and the app lists nearby WiFi networks (or join WiFi yourself in WiFi settings) — tap to open app settings'], ['ค้นหา WiFi OBD2 ได้เฉพาะในแอป Android (รุ่นใหม่)', 'WiFi OBD2 search works only in the Android app (new version)'], ['ค้นหา WiFi OBD2 ได้เฉพาะในแอป Android', 'WiFi OBD2 search works only in the Android app'], ['แอปรุ่นนี้ยังไม่รองรับ WiFi OBD2', 'This app version does not support WiFi OBD2'], ['ค้นหา WiFi ไม่ตอบสนอง (หมดเวลา)', 'WiFi search timed out'], ['ค้นหา WiFi ไม่สำเร็จ', 'WiFi search failed'], ['เชื่อม WiFi ไม่สำเร็จ (หมดเวลา)', 'Joining WiFi timed out'], ['เชื่อมต่อ WiFi OBD2 ไม่สำเร็จ (หมดเวลา)', 'WiFi OBD2 connection timed out'], ['WiFi ยังไม่พร้อม', 'WiFi is not ready'], ['รหัสผ่านของ WiFi “', 'Password of WiFi “'], ['กำลังต่อ WiFi “', 'Joining WiFi “'], ['” … (ถ้ามีหน้าต่างให้ยืนยัน กด “เชื่อมต่อ/อนุญาต”)', '” … (if a prompt appears, tap Connect/Allow)'], ['ต่อ WiFi ไม่สำเร็จ', 'Could not join WiFi'], ['ที่อยู่อแดปเตอร์ WiFi (IP:พอร์ต) เช่น 192.168.0.10:35000', 'WiFi adapter address (IP:port), e.g. 192.168.0.10:35000'], ['รูปแบบไม่ถูกต้อง — ตัวอย่าง 192.168.0.10:35000', 'Invalid format — example 192.168.0.10:35000'], ['ต่อ WiFi ของอแดปเตอร์ในตั้งค่ามือถือ', 'Join the adapter\'s WiFi in the phone settings'], ['ไม่แน่ใจว่าเป็น ELM327 — ลองเชื่อมต่อดู', 'Not sure it is an ELM327 — trying to connect'], ['WiFi ของอแดปเตอร์หลุด', 'The adapter\'s WiFi dropped'], ['อแดปเตอร์ WiFi ปิดการเชื่อมต่อเอง', 'The WiFi adapter closed the connection'],
    ['รอบเครื่อง', 'engine RPM'],
  ];
  const lang0 = (() => { try { return localStorage.getItem('jht.lang') || 'th'; } catch (e) { return 'th'; } })();
  let lang = lang0 === 'en' ? 'en' : 'th';
  const HAS = /[฀-๿]/;
  const EXACT = new Map(), SUB = [];
  for (const [t, e] of D) { const n = (t.match(/[฀-๿]/g) || []).length; if (n < 5) EXACT.set(t.trim(), e); else SUB.push([t, e]); EXACT.set(t.trim(), e); }
  SUB.sort((a, b) => b[0].length - a[0].length);
  function tr(s) {
    if (!HAS.test(s)) return s;
    const t = s.trim(), hit = EXACT.get(t);
    if (hit != null) return s.replace(t, hit);
    let o = s;
    for (const [k, v] of SUB) if (o.indexOf(k) >= 0) o = o.split(k).join(v);
    return o;
  }
  const done = new WeakMap(), orig = new WeakMap(), origA = new WeakMap();
  let busy = false;
  function nodeEn(n) {
    const v = n.nodeValue; if (!HAS.test(v) || done.get(n) === v) return;
    const t = tr(v); orig.set(n, v); done.set(n, t);
    if (t !== v) { busy = true; n.nodeValue = t; busy = false; }
  }
  function walk(el, fn) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentNode && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const a = []; while (w.nextNode()) a.push(w.currentNode); a.forEach(fn);
  }
  const ATTRS = ['title', 'placeholder'];
  function attrs(en) {
    document.querySelectorAll('[title],[placeholder]').forEach((e) => ATTRS.forEach((a) => {
      const v = e.getAttribute(a); if (v == null) return;
      let m = origA.get(e); if (!m) { m = {}; origA.set(e, m); }
      if (en) { if (HAS.test(v)) { m[a] = v; e.setAttribute(a, tr(v)); } } else if (m[a] != null) { e.setAttribute(a, m[a]); delete m[a]; }
    }));
  }
  const mo = new MutationObserver((ms) => {
    if (lang !== 'en' || busy) return;
    for (const m of ms) {
      if (m.type === 'characterData') { if (HAS.test(m.target.nodeValue)) nodeEn(m.target); }
      else m.addedNodes.forEach((n) => { if (n.nodeType === 3) { if (HAS.test(n.nodeValue)) nodeEn(n); } else if (n.nodeType === 1) walk(n, nodeEn); });
    }
  });
  function apply() {
    document.documentElement.lang = lang;
    if (lang === 'en') { walk(document.body, nodeEn); attrs(true); }
    else { busy = true; walk(document.body, (n) => { if (orig.has(n)) { n.nodeValue = orig.get(n); orig.delete(n); done.delete(n); } }); busy = false; attrs(false); }
    document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
  }
  function set(l) {
    lang = l === 'en' ? 'en' : 'th';
    try { localStorage.setItem('jht.lang', lang); } catch (e) { /* ignore */ }
    apply(); window.dispatchEvent(new Event('jetlang'));
  }
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => set(b.dataset.lang)));
  root.JetI18N = { lang: () => lang, set, tr, apply };
  if (lang === 'en') apply(); else document.documentElement.lang = 'th';
})(window);
