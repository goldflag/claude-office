// Reading and drawing a Claude Code terminal screen, shared by the server's
// safety check, the terminal panel and the desk monitors.

/** A terminal screen that is showing a menu or dialog rather than the prompt box. */
const DIALOG = /❯\s*\d+\.\s|Esc to cancel|Enter to select|Do you want to /;

export const looksLikeDialog = (lines: string[]) => DIALOG.test(lines.slice(-25).join("\n"));

/** Wraps one line of text to `width`, with a prefix on the first row and an indent on the rest. */
export function wrap(text: string, prefix: string, indent: string, width: number): string[] {
  const lead = /^\s*/.exec(text)![0];
  const out: string[] = [];
  let line = prefix + lead;
  let empty = true;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!empty && line.length + 1 + word.length > width) {
      out.push(line);
      line = indent + lead;
      empty = true;
    }
    line += (empty ? "" : " ") + word;
    empty = false;
  }
  out.push(line);
  return out;
}

/** Wraps text that may run over several lines, dropping the markdown markers Claude Code would have rendered. */
export function block(text: string, prefix: string, indent: string, width: number): string[] {
  return text
    .replace(/\*\*|`/g, "")
    .split("\n")
    .flatMap((para, i) => wrap(para, i === 0 ? prefix : indent, indent, width));
}
