// The copy buttons beside commands. Without script, or without the
// clipboard API (browsers offer it only over https), the buttons stay
// hidden and the commands are plain text to select.
const live = document.querySelector<HTMLElement>('[data-copy-status]');
const say = (text: string) => {
  if (live) live.textContent = text;
};

if (typeof navigator.clipboard?.writeText === 'function') {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    const code = button.closest('.command')?.querySelector('code');
    if (!code) continue;
    button.hidden = false;
    let timer: number | undefined;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent ?? '');
        button.textContent = 'Copied';
        say('Copied to the clipboard.');
      } catch {
        button.textContent = "Couldn't copy";
        say("Couldn't copy; select the command instead.");
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (button.textContent = 'Copy'), 2000);
    });
  }
}

export {};
