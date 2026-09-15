/**
 * CS2 embeds chat color control bytes (\x01, \x07, ...) in RCON responses, and
 * container logs carry ANSI escapes plus bare carriage returns from progress
 * output. Both would render as mojibake in the browser.
 */

// eslint-disable-next-line no-control-regex
// Source chat colors occupy this control-byte range, but TAB (09), LF (0A),
// and CR (0D) are real formatting and must survive. A broad 01-10 range would
// silently collapse multi-line responses such as status and cvarlist.
const CHAT_COLORS = /[\x01-\x08\x0b\x0c\x0e-\x10]/g;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function sanitizeRcon(text: string): string {
  return text.replace(CHAT_COLORS, "").replace(ANSI, "").replace(/\r\n|\r/g, "\n");
}

export function sanitizeLog(text: string): string {
  return text.replace(ANSI, "").replace(CHAT_COLORS, "").replace(/\r\n|\r/g, "\n");
}
