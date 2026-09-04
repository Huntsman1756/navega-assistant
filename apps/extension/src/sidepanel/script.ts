/**
 * Side panel UI.
 *
 * Deliberately tiny. It asks the user a question, captures a sanitized
 * snapshot from the active tab after an explicit action, forwards it to the
 * service worker, and shows a single answer.
 *
 * No autonomous actions, no follow-up loop, no voice.
 */
import type { AccessibleDOMSnapshot } from "@guided-web/protocol";
import type { AssistResultMessage, SnapshotMessage } from "../shared/messages";

const questionInput = document.getElementById("question") as HTMLTextAreaElement;
const helpButton = document.getElementById("help-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const answerEl = document.getElementById("answer") as HTMLDivElement;
const modeEl = document.getElementById("mode") as HTMLDivElement;
const operatorSection = document.querySelector("section.operator") as HTMLElement;
const outcomeSelect = document.getElementById("outcome") as HTMLSelectElement;

modeEl.innerHTML = "Context: <strong>DOM only</strong>";

// Operator validation recording (local only, hidden in P0 by default).
// A validation build may set ?operator=1 to expose it for a controlled session.
if (new URLSearchParams(location.search).get("operator") === "1") {
  operatorSection.hidden = false;
  outcomeSelect.addEventListener("change", () => {
    // Stored locally for the operator. Never uploaded in P0.
    const record = {
      at: new Date().toISOString(),
      outcome: outcomeSelect.value,
      question: questionInput.value.trim(),
      message: answerEl.textContent,
    };
    console.debug("[P0 validation]", record);
  });
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function renderResult(result: AssistResultMessage): void {
  if (result.type !== "GWA_ASSIST_RESULT") {
    setStatus("I couldn't help with that.");
    answerEl.textContent = "";
    return;
  }
  if (result.ok) {
    setStatus("");
    answerEl.textContent = result.decision.message;
    return;
  }
  setStatus(`I couldn't help with that. (${result.error})`);
  answerEl.textContent = "";
}

function captureSnapshot(tabId: number): Promise<AccessibleDOMSnapshot> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      close();
      reject(new Error("snapshot timeout"));
    }, 6000);

    const onMessage = (message: unknown) => {
      const msg = message as SnapshotMessage | undefined;
      if (msg?.type === "GWA_SNAPSHOT" && !settled) {
        settled = true;
        close();
        resolve(msg.snapshot);
      }
    };

    const close = () => {
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(onMessage);
    };

    chrome.runtime.onMessage.addListener(onMessage);

    chrome.scripting
      .executeScript({ target: { tabId }, files: ["content/extract.js"] })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        close();
        reject(err);
      });
  });
}

async function onHelp(): Promise<void> {
  const question = questionInput.value.trim() || "I don't know what to do here.";

  helpButton.disabled = true;
  setStatus("Taking a simple snapshot of this page…");
  answerEl.textContent = "";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("Could not find the active tab.");
      return;
    }

    const snapshot = await captureSnapshot(tab.id);
    setStatus("Asking the assistant…");

    const result = (await chrome.runtime.sendMessage({
      type: "GWA_ASSIST",
      snapshot,
      question,
    })) as AssistResultMessage;

    renderResult(result);
  } catch {
    setStatus("Something went wrong. Please try again.");
  } finally {
    helpButton.disabled = false;
  }
}

helpButton.addEventListener("click", () => void onHelp());
