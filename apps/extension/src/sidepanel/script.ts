/**
 * Side panel entry point.
 *
 * Wires the conversation controller to the real Chrome APIs. The controller
 * holds the authoritative live session; chrome.storage.session is only a
 * recoverable ephemeral checkpoint. No provider key, no secrets, no browsing
 * history ever lives here.
 */
import { createController, createChromeFacade } from "./controller";

const els = {
  conversation: document.getElementById("conversation") as HTMLElement,
  input: document.getElementById("question") as HTMLTextAreaElement,
  helpButton: document.getElementById("help-btn") as HTMLButtonElement,
  newHelpButton: document.getElementById("new-help-btn") as HTMLButtonElement,
  status: document.getElementById("status") as HTMLElement,
  permission: document.getElementById("permission") as HTMLElement,
  permissionText: document.getElementById("permission-text") as HTMLElement,
  permissionAllow: document.getElementById("permission-allow") as HTMLButtonElement,
  permissionDeny: document.getElementById("permission-deny") as HTMLButtonElement,
};

const modeEl = document.getElementById("mode") as HTMLElement;
modeEl.innerHTML = "Contexto: <strong>solo DOM</strong>";

const controller = createController(createChromeFacade(chrome), els);
controller.init();

els.helpButton.addEventListener("click", () => void controller.askHelp());
els.newHelpButton.addEventListener("click", () => void controller.reset());
els.permissionAllow.addEventListener("click", () => void controller.allowOrigin());
els.permissionDeny.addEventListener("click", () => void controller.denyOrigin());

els.input.addEventListener("keydown", (event) => {
  controller.onKeydown(event);
});
