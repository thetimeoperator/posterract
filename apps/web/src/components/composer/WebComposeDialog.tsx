import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@posterract/hyperkit";

/** Native modal focus handling, scoped to the web composer. */
export function WebComposeDialog({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);
  return <dialog ref={ref} className="web-compose-dialog glass" aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    {open && <>
      <header><h2>{title}</h2><button type="button" aria-label="Close dialog" onClick={onClose}><X size={17} /></button></header>
      <div className="web-compose-dialog-body">{children}</div>
      <footer><Button size="sm" variant="secondary" onClick={onClose}>Done</Button></footer>
    </>}
  </dialog>;
}
