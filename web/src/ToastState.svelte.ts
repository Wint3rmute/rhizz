import { SvelteMap } from "svelte/reactivity";

export type ToastLevel = "info" | "warning" | "error" | "success";

export interface Toast {
  id: number;
  message: string;
  level: ToastLevel;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class ToastState {
  toasts = $state<Toast[]>([]);
  #nextId = 0;
  #timeouts = new SvelteMap<number, ReturnType<typeof setTimeout>>();

  show(
    message: string,
    level: ToastLevel = "info",
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): number {
    const id = this.#nextId;
    this.#nextId += 1;
    this.toasts.push({ id, message, level });

    const timeout = setTimeout(() => {
      this.dismiss(id);
    }, timeoutMs);
    this.#timeouts.set(id, timeout);

    return id;
  }

  dismiss(id: number): void {
    const index = this.toasts.findIndex((toast) => toast.id === id);
    if (index !== -1) this.toasts.splice(index, 1);

    const timeout = this.#timeouts.get(id);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      this.#timeouts.delete(id);
    }
  }
}

export const toastState = new ToastState();
