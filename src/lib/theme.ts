// Theme constants shared by the server layout and the client toggle (A156). Kept out of the
// "use client" module: a server component importing a value from a client module receives a
// client reference, not the string.

export const THEME_STORAGE_KEY = "theme";

/** Runs in <head> before first paint: applies a saved light/dark choice, so nothing flashes. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
