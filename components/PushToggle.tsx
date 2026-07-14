"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushToggle() {
  const { toast } = useToast();
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setSupported(false);
      return;
    }
    navigator.serviceWorker
      .getRegistration()
      .then(async (reg) => {
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        setSubscribed(!!sub);
      })
      .catch(() => {});
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast("Notification permission denied", "error");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
      });
      await apiFetch("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      setSubscribed(true);
      toast("Browser notifications enabled");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not enable", "error");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await apiFetch("/api/push/subscribe", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast("Browser notifications disabled");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not disable", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <p className="text-sm text-slate-400">
        Your browser doesn’t support push notifications.
      </p>
    );
  }
  if (!vapid) {
    return (
      <p className="text-sm text-slate-400">
        Push notifications aren’t configured on this server yet.
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-slate-500">
        {subscribed
          ? "On — you’ll get reminders & mentions even when the app is closed."
          : "Get reminders and @mentions as desktop/mobile notifications, even when PMApp is closed."}
      </div>
      <button
        onClick={subscribed ? disable : enable}
        disabled={busy}
        className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
          subscribed
            ? "border border-slate-300 text-slate-700 hover:bg-slate-50"
            : "bg-indigo-600 text-white hover:bg-indigo-700"
        }`}
      >
        {busy ? "…" : subscribed ? "Disable" : "Enable"}
      </button>
    </div>
  );
}
