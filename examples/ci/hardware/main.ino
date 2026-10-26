#include <Arduino.h>

/*
 * A CI run that checks the bench, not just the serial output: an LED lit from
 * pin 13 and an LCD showing a line. The sketch would pass a serial-only check
 * with both unplugged.
 */
void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
  digitalWrite(13, HIGH);
  lcd.begin(16, 2);
  lcd.print("hardware ok");
  Serial.println("hardware ready");
}

void loop() {}
