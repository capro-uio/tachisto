export { BROWSER_BUNDLE } from "tachisto-schemas/files";

/** The global an extension's browser bundle defines, such as jsPsychExtensionWebgazer. */
export function extensionIdentifier(extension: string) {
  return pluginIdentifier(`extension-${extension}`);
}

/** The global a plugin's browser bundle defines, such as jsPsychHtmlKeyboardResponse. */
export function pluginIdentifier(plugin: string) {
  const camelCased = plugin
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  return `jsPsych${camelCased}`;
}
