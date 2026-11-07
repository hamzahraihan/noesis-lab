#include <Arduino.h>

/*
 * A CI project that exercises the bench's simulated network: an ESP32
 * joins noesis-bench, fetches the time from api.noesis, and prints it to
 * serial. No external network is involved -- the bench owns the network,
 * so the run is deterministic.
 */
void setup() {
  Serial.begin(9600);

  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != 3) {
    delay(50);
  }
  Serial.println("connected");

  while (!net.get("http://api.noesis/time")) {
    delay(50);
  }
  Serial.println(net.read());
}

void loop() {}
