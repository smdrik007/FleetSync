/*
 * FleetSync vehicle tracker: ESP32 + NEO-6M GPS + SIM800L (2G GPRS).
 * Posts GPS fixes to POST /api/v1/ingest/json (see backend/src/routes/ingest.js).
 *
 * Libraries (Arduino Library Manager): TinyGPSPlus, TinyGSM, ArduinoHttpClient.
 * Board: "ESP32 Dev Module".
 *
 * Wiring (everything on the car USB charger's 5V, grounds joined):
 *   NEO-6M TX  -> GPIO16      SIM800L TX -> GPIO26      SIM800L RX -> GPIO27
 *   1000 uF capacitor across SIM800L 5V/GND, or the ESP32 resets when the modem transmits.
 */

#define TINY_GSM_MODEM_SIM800
#define TINY_GSM_RX_BUFFER 1024
#include <TinyGsmClient.h>
#include <ArduinoHttpClient.h>
#include <TinyGPSPlus.h>

// ---- config ----
const char SERVER[]      = "your-server.example.com";   // host only, no http://
const int  PORT          = 80;
const char DEVICE_KEY[]  = "fsk_paste_the_key_shown_once_in_fleetsync";
const char APN[]         = "gpinternet";                // Robi: "internet", Banglalink: "blweb"
const uint32_t SEND_INTERVAL_S = 10;

const int GPS_RX = 16, MODEM_RX = 26, MODEM_TX = 27, LED = 2;
const int MAX_POINTS = 300;   // ~50 min of no signal at 10 s
const int BATCH = 50;         // points per request; keeps each 2G upload small
const float PARKED_KMH = 2;   // GPS shows 1-3 km/h of jitter when standing still
const float MIN_SATS = 5, MAX_HDOP = 2.5;

struct Point { char ts[21]; double lat, lng; float speed, heading, accuracy; };
Point buf[MAX_POINTS];
int count = 0;

TinyGPSPlus gps;
TinyGsm modem(Serial1);
TinyGsmClient client(modem);
HttpClient http(client, SERVER, PORT);

uint32_t lastSample = 0, offlineSince = 0;

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  Serial2.setRxBufferSize(1024);   // GPS keeps talking while an upload blocks
  Serial2.begin(9600, SERIAL_8N1, GPS_RX, -1);
  Serial1.begin(9600, SERIAL_8N1, MODEM_RX, MODEM_TX);
  Serial.println("modem starting...");
  modem.restart();
}

void loop() {
  while (Serial2.available()) gps.encode(Serial2.read());
  if (millis() - lastSample < SEND_INTERVAL_S * 1000) return;
  lastSample = millis();
  sample();
  if (count) send();
}

/** Buffer one fix if it is fresh and good enough. */
void sample() {
  bool good = gps.location.isValid() && gps.location.age() < 2000 && gps.date.isValid() && gps.time.isValid()
           && gps.satellites.value() >= MIN_SATS && gps.hdop.hdop() < MAX_HDOP;
  if (!good) { Serial.printf("waiting for fix (sats %u, hdop %.1f)\n", (unsigned)gps.satellites.value(), gps.hdop.hdop()); return; }

  if (count == MAX_POINTS) { memmove(buf, buf + 1, (MAX_POINTS - 1) * sizeof(Point)); count--; }   // drop the oldest
  Point &p = buf[count++];
  snprintf(p.ts, sizeof p.ts, "%04u-%02u-%02uT%02u:%02u:%02uZ", gps.date.year(), gps.date.month(), gps.date.day(),
           gps.time.hour(), gps.time.minute(), gps.time.second());
  p.lat = gps.location.lat();
  p.lng = gps.location.lng();
  p.speed = gps.speed.kmph() < PARKED_KMH ? 0 : gps.speed.kmph();
  p.heading = gps.course.deg();
  p.accuracy = gps.hdop.hdop() * 2.5;   // rough metres: HDOP x typical NEO-6M range error
}

/** GPRS up? Reboots the modem (AT+CFUN=1,1) after 5 minutes without it. */
bool online() {
  if (modem.isGprsConnected()) { offlineSince = 0; return true; }
  if (!offlineSince) offlineSince = millis();
  if (millis() - offlineSince > 5 * 60 * 1000UL) { Serial.println("no data for 5 min, restarting modem"); modem.restart(); offlineSince = millis(); }
  return modem.waitForNetwork(10000) && modem.gprsConnect(APN);
}

/** Upload the oldest BATCH points; drop them only once the server has them. */
void send() {
  if (!online()) { Serial.printf("offline, %d points buffered\n", count); return; }
  int n = min(count, BATCH);
  String body = "[";
  char item[200];
  for (int i = 0; i < n; i++) {
    Point &p = buf[i];
    snprintf(item, sizeof item, "%s{\"ts\":\"%s\",\"lat\":%.6f,\"lng\":%.6f,\"speed\":%.1f,\"heading\":%.0f,\"accuracy\":%.1f}",
             i ? "," : "", p.ts, p.lat, p.lng, p.speed, p.heading, p.accuracy);
    body += item;
  }
  body += "]";

  http.beginRequest();
  http.post("/api/v1/ingest/json");
  http.sendHeader("Content-Type", "application/json");
  String auth = String("Bearer ") + DEVICE_KEY;
  http.sendHeader("Authorization", auth.c_str());
  http.sendHeader("Content-Length", body.length());
  http.beginBody();
  http.print(body);
  http.endRequest();
  int status = http.responseStatusCode();
  String resp = http.responseBody();
  http.stop();
  Serial.printf("%d %s\n", status, resp.c_str());

  if (status == 401 || status == 403) halt();   // wrong key, or device disabled in FleetSync
  // 200 = stored; other 4xx (not 429) = the server rejects these points, so resending would loop forever
  if (status == 200 || (status >= 400 && status < 500 && status != 429)) {
    memmove(buf, buf + n, (count - n) * sizeof(Point));
    count -= n;
  }
}

void halt() {
  Serial.println("device key rejected, check DEVICE_KEY and that the device is active");
  for (;;) { digitalWrite(LED, !digitalRead(LED)); delay(200); }
}
