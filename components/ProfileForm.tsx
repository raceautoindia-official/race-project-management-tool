"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "./ToastProvider";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export default function ProfileForm({
  initialName,
  initialPhone,
  initialWhatsapp,
  whatsappAvailable,
}: {
  initialName: string;
  initialPhone: string;
  initialWhatsapp: boolean;
  /** False when the server has no WhatsApp credentials configured. */
  whatsappAvailable: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [whatsapp, setWhatsapp] = useState(initialWhatsapp);
  const [busy, setBusy] = useState(false);

  const unchanged =
    name.trim() === initialName.trim() &&
    phone.trim() === initialPhone.trim() &&
    whatsapp === initialWhatsapp;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiFetch("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          whatsappOptIn: whatsapp,
        }),
      });
      toast("Profile updated");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update profile", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label htmlFor="profile-name" className="mb-1 block text-sm font-medium text-slate-700">
          Display name
        </label>
        <input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="profile-phone" className="mb-1 block text-sm font-medium text-slate-700">
          Mobile number{" "}
          <span className="font-normal text-slate-500">(for WhatsApp alerts)</span>
        </label>
        <input
          id="profile-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          maxLength={20}
          placeholder="+91 98765 43210"
          className={inputClass}
        />
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={whatsapp}
          onChange={(e) => setWhatsapp(e.target.checked)}
          disabled={!phone.trim()}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 disabled:opacity-50"
        />
        <span>
          Send my notifications on WhatsApp too
          {!whatsappAvailable && (
            <span className="block text-xs text-slate-500">
              WhatsApp isn’t set up on this server yet — your choice is saved for when it is.
            </span>
          )}
        </span>
      </label>

      <button
        type="submit"
        disabled={busy || unchanged || !name.trim()}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
