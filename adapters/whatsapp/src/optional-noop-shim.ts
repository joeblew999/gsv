// Throwing shim for baileys' optional Node-only deps that don't exist in Workers.
//
// baileys dynamically requires these inside Promise chains with `.catch`:
//
//   const lib = await Promise.resolve()
//     .then(() => require('jimp'))
//     .catch(() => undefined);  // graceful skip if require throws
//
//   if (lib) { /* use lib */ }
//
// The whatsapp adapter's `wrangler.jsonc` aliases `jimp`, `link-preview-js`, and
// `qrcode-terminal` to this file. We THROW at module-load so the .catch fires,
// `lib` becomes undefined, and baileys takes its no-op branch — instead of
// thinking the dep is loaded and crashing later when it tries to use it.
//
// Affected baileys code paths (all opt-in features):
//   - jimp:            media decoding/processing
//   - link-preview-js: URL preview metadata
//   - qrcode-terminal: CLI QR rendering (never useful in a Worker anyway)
//
// If gsv ever needs any of these, replace the alias with a real Worker-
// compatible implementation per package.

throw new Error(
  "[gsv/whatsapp] optional Node-only dep (jimp / link-preview-js / qrcode-terminal) " +
    "is not available in the Workers runtime — baileys' .catch() handler should swallow this.",
);
