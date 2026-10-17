"use client";

// Small pieces shared by the admin tabs.

import Modal from "@/components/Modal";
import { Button } from "@/components/preview/ui";

/** Accessible on/off switch. */
export function Toggle({ checked, onChange, label, disabled = false, title }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-indigo-600" : "bg-slate-300"
      }`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

/** Yes/no confirmation in a Modal (never window.confirm). */
export function ConfirmModal({ open, title, body, confirmLabel, onConfirm, onClose }: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4 text-sm text-slate-600">
        {body}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Keep it</Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Short grey explainer paragraph under a section title. */
export function HelpText({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 max-w-3xl text-sm text-slate-500">{children}</p>;
}
