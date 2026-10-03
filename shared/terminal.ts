// Reading a Claude Code terminal screen, shared by the server's safety check
// and the monitor that shows the screen.

/** A terminal screen that is showing a menu or dialog rather than the prompt box. */
const DIALOG = /❯\s*\d+\.\s|Esc to cancel|Enter to select|Do you want to /;

export const looksLikeDialog = (lines: string[]) => DIALOG.test(lines.slice(-25).join("\n"));
