#include <Arduino.h>

HTTPClient http;

/*
 * A CI project that fetches three endpoints in sequence: the time from
 * api.noesis, then temperature and humidity from sensor.noesis. Each request
 * blocks until the answer is ready, so the sketch waits for one before
 * starting the next.
 */
void setup() {
  Serial.begin(9600);

  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != 3) {
    delay(50);
  }
  Serial.println("connected");

  http.begin("http://api.noesis/time");
  Serial.println(http.GET());
  Serial.println(http.read());

  http.begin("http://sensor.noesis/temperature");
  Serial.println(http.GET());
  Serial.println(http.read());

  http.begin("http://sensor.noesis/humidity");
  Serial.println(http.GET());
  Serial.println(http.read());
}

void loop() {}
