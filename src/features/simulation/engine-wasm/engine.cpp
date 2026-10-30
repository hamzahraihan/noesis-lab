/**
 * Freestanding runtime shared by the solver and netlist cores.
 *
 * Everything here is deliberately small: a bump allocator over wasm linear
 * memory, the diode profile table, and the string helpers the netlist uses to
 * look pins and knobs up by their TS ids. There is no libc; `memcpy` and
 * `memset` are defined because clang's loop-idiom pass can emit calls to them
 * even from explicit loops.
 */

#include "engine.h"

extern "C" {
extern unsigned char __heap_base;
}

namespace engine {

namespace {
uintptr_t heap_top = 0;

ProfileIn* profile_table = nullptr;
int32_t profile_count = 0;
CurvePoint* curve_table = nullptr;
bool curves_ready = false;

constexpr double FORWARD_SAMPLE_MULTIPLIERS[10] = {
    1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.3, 1, 3,
};

void build_curve(const ProfileIn& profile, CurvePoint* out) {
  const double thermal_scale = profile.values[3] * THERMAL_VOLTAGE;
  const double series_ohms = profile.values[2];
  const double saturation_amps =
      profile.values[1] *
      js_exp(-(profile.values[0] - profile.values[1] * series_ohms) / thermal_scale);

  out[0].volts = -(profile.values[5] + 0.5);
  out[0].amps = -profile.values[6];
  out[1].volts = -profile.values[5];
  out[1].amps = -profile.values[4];
  out[2].volts = 0;
  out[2].amps = 0;

  for (int32_t i = 0; i < 10; i++) {
    const double amps = profile.values[1] * FORWARD_SAMPLE_MULTIPLIERS[i];
    const double junction_volts = thermal_scale * js_log1p(amps / saturation_amps);
    out[3 + i].volts = junction_volts + amps * series_ohms;
    out[3 + i].amps = amps;
  }
}

Linear segment(const CurvePoint& lower, const CurvePoint& upper, double voltage_across) {
  const double siemens = (upper.amps - lower.amps) / (upper.volts - lower.volts);
  return {lower.amps + siemens * (voltage_across - lower.volts), siemens};
}
}  // namespace

uint32_t alloc_bytes(uint32_t bytes) {
  if (bytes == 0) return 0;
  if (heap_top == 0) heap_top = reinterpret_cast<uintptr_t>(&__heap_base);
  heap_top = (heap_top + 7u) & ~static_cast<uintptr_t>(7u);
  const uintptr_t end = heap_top + bytes;
  const uintptr_t memory_bytes = static_cast<uintptr_t>(__builtin_wasm_memory_size(0)) * 65536u;
  if (end > memory_bytes) {
    const uintptr_t pages = (end - memory_bytes + 65535u) / 65536u;
    if (__builtin_wasm_memory_grow(0, pages) == static_cast<size_t>(-1)) return 0;
  }
  const uint32_t result = static_cast<uint32_t>(heap_top);
  heap_top = end;
  return result;
}

const char* string_at(const char* strings, int32_t strings_bytes, uint32_t offset) {
  if (strings == nullptr || offset >= static_cast<uint32_t>(strings_bytes)) return "";
  return strings + offset;
}

bool streq(const char* a, const char* b) {
  while (*a != '\0' && *a == *b) {
    a++;
    b++;
  }
  return *a == *b;
}

bool set_profiles_impl(const double* values, int32_t count) {
  if (count < 0) return false;

  if (count == profile_count) {
    const double* flat = reinterpret_cast<const double*>(profile_table);
    bool same = true;
    for (int32_t i = 0; i < count * 7; i++) {
      if (flat[i] != values[i]) {
        same = false;
        break;
      }
    }
    if (same) return true;
  }

  ProfileIn* next_profiles = nullptr;
  CurvePoint* next_curves = nullptr;
  if (count > 0) {
    next_profiles =
        reinterpret_cast<ProfileIn*>(alloc_bytes(static_cast<uint32_t>(count) * sizeof(ProfileIn)));
    next_curves = reinterpret_cast<CurvePoint*>(
        alloc_bytes(static_cast<uint32_t>(count) * CURVE_POINTS * sizeof(CurvePoint)));
    if (next_profiles == nullptr || next_curves == nullptr) return false;
    double* flat_next = reinterpret_cast<double*>(next_profiles);
    for (int32_t i = 0; i < count * 7; i++) flat_next[i] = values[i];
    for (int32_t i = 0; i < count; i++) {
      build_curve(next_profiles[i], next_curves + i * CURVE_POINTS);
    }
  }

  profile_table = next_profiles;
  curve_table = next_curves;
  profile_count = count;
  curves_ready = true;
  return true;
}

Linear linearise_diode(double voltage_across, int32_t profile_index) {
  if (!curves_ready || profile_index < 0 || profile_index >= profile_count) return {0, 0};
  const CurvePoint* curve = curve_table + profile_index * CURVE_POINTS;
  const int32_t last = CURVE_POINTS - 1;

  if (voltage_across <= curve[0].volts) return segment(curve[0], curve[1], voltage_across);
  if (voltage_across >= curve[last].volts) {
    return segment(curve[last - 1], curve[last], voltage_across);
  }
  for (int32_t i = 0; i < last; i++) {
    if (voltage_across >= curve[i].volts && voltage_across <= curve[i + 1].volts) {
      return segment(curve[i], curve[i + 1], voltage_across);
    }
  }
  return {0, 0};
}

}  // namespace engine

extern "C" void* memcpy(void* destination, const void* source, size_t bytes) {
  unsigned char* out = static_cast<unsigned char*>(destination);
  const unsigned char* in = static_cast<const unsigned char*>(source);
  for (size_t i = 0; i < bytes; i++) out[i] = in[i];
  return destination;
}

extern "C" void* memset(void* destination, int value, size_t bytes) {
  unsigned char* out = static_cast<unsigned char*>(destination);
  for (size_t i = 0; i < bytes; i++) out[i] = static_cast<unsigned char>(value);
  return destination;
}

extern "C" uint32_t wasm_alloc(uint32_t bytes) { return engine::alloc_bytes(bytes); }

extern "C" int32_t set_profiles(const double* values, int32_t count) {
  return engine::set_profiles_impl(values, count) ? 1 : 0;
}
