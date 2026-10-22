#include <Arduino.h>

/*
 * The sketch a CI run checks: an LED on pin 13, and a line in the serial
 * output every second so the run has something to read.
 */
void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
  Serial.println("blink ready");
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
  Serial.println("tick");
}
