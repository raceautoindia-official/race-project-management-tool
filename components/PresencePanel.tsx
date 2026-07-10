"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { RoleBadge } from "@/components/Badge";
import { apiFetch } from "@/lib/api-client";
import { formatRelative } from "@/lib/format";

export interface PresenceUser {
  id: number;
  name: string;
  role: "admin" | "member";
  last_seen_at: string | null;
  online: boolean;
  activity_count: number;
}

export default function PresencePanel({
  initial,
}: {
  initial: PresenceUser[];
}) {
  const [users, setUsers] = useState<PresenceUser[]>(initial);
  const onlineCount = users.filter((u) => u.online).length;

  // Live refresh every 30s.
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const data = await apiFetch<{ users: PresenceUser[] }>("/api/presence");
        if (active) setUsers(data.users);
      } catch {
        /* ignore transient errors */
      }
    };
    const id = setInterval(tick, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="font-semibold text-slate-800">Team presence</h2>
        <span className="flex items-center gap-1.5 text-sm text-slate-500">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          {onlineCount} online
        </span>
      </div>
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
        {users.map((u) => (
          <li key={u.id} className="flex items-center gap-3 px-5 py-2.5">
            <div className="relative">
              <Avatar name={u.name} size="md" />
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                  u.online ? "bg-green-500" : "bg-slate-300"
                }`}
                title={u.online ? "Online" : "Offline"}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-800">
                  {u.name}
                </span>
                <RoleBadge role={u.role} />
              </div>
              <div className="text-xs text-slate-400">
                {u.online
                  ? "Active now"
                  : u.last_seen_at
                    ? `Last seen ${formatRelative(u.last_seen_at)}`
                    : "Never signed in"}
                {" · "}
                {u.activity_count} actions
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
