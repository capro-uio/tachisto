import { mount } from "svelte";
import { applyTheme } from "./lib/theme.svelte.ts";
import App from "./App.svelte";
import "tachisto-brand/fonts.css";
import "tachisto-brand/tokens.css";
import "tachisto-brand/base.css";
import "tachisto-brand/logos.css";
import "./app.css";

applyTheme();

export default mount(App, { target: document.querySelector("#app")! });
