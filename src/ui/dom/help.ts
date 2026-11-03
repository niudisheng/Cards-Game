const SEEN_KEY = 'dlmg.helpSeen.v1';

export interface HelpView {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** 首次进入时自动打开一次，之后靠右上角按钮或提示条打开。 */
  maybeOpenOnFirstVisit(delayMs?: number): void;
}

function mustGet<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`缺少 DOM 节点：${selector}`);
  return node;
}

function hasSeenHelp(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可
  }
}

export function mountHelp(): HelpView {
  const help = mustGet<HTMLElement>('#help');
  const panel = mustGet<HTMLElement>('#help .sheet__panel');
  let lastFocused: HTMLElement | null = null;
  let timer: number | null = null;

  const open = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (!help.hidden) return;
    markSeen();
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    help.hidden = false;
    panel.scrollTop = 0;
    panel.focus({ preventScroll: true });
  };

  const close = (): void => {
    if (help.hidden) return;
    help.hidden = true;
    lastFocused?.focus({ preventScroll: true });
    lastFocused = null;
  };

  const toggle = (): void => {
    if (help.hidden) open();
    else close();
  };

  mustGet<HTMLElement>('#btn-help').addEventListener('click', toggle);
  mustGet<HTMLElement>('#btn-help-note').addEventListener('click', open);

  help.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-close="help"]')) close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !help.hidden) close();
  });

  return {
    open,
    close,
    isOpen: () => !help.hidden,
    maybeOpenOnFirstVisit(delayMs = 700): void {
      if (hasSeenHelp()) return;
      timer = window.setTimeout(() => {
        timer = null;
        open();
      }, delayMs);
    },
  };
}
