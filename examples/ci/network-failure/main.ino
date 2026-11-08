#include <Arduino.h>

HTTPClient http;

/*
 * A CI project that exercises the failure path: a sketch asks for a host
 * the network does not answer for, checks the failure, and keeps running.
 * The serial output proves the sketch did not freeze.
 */
void setup() {
  Serial.begin(9600);

  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != 3) {
    delay(50);
  }
  Serial.println("connected");

  http.begin("http://no.such.host/time");
  Serial.println(http.GET());
  if (http.get() == -1) {
    Serial.println("network failed");
  }
  Serial.println("still running");
}

void loop() {}
