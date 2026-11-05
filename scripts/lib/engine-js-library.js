/**
 * Emscripten JS library for the three host functions the freestanding C++ core
 * imports: `js_exp`, `js_log1p`, `js_pow`.
 *
 * The freestanding build (`npm run build:engine`) passes these directly to
 * `WebAssembly.instantiate`; the browser module needs the same functions
 * compiled into its glue, so Emscripten gets them here instead of leaving the
 * imports undefined. The signatures are doubles, matching `engine.h`.
 */
mergeInto(LibraryManager.library, {
  js_exp__sig: 'dd',
  js_exp: function (x) {
    return Math.exp(x);
  },
  js_log1p__sig: 'dd',
  js_log1p: function (x) {
    return Math.log1p(x);
  },
  js_pow__sig: 'ddd',
  js_pow: function (base, exponent) {
    return Math.pow(base, exponent);
  },
});
