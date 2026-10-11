"use client";
import { LogoMotion } from "./logo-motion";
import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";

import type { Profile, State } from "@/lib/model";
import {
  avatarUrl,
  profileInitials,
  profileStatus,
} from "@/lib/profile-identity";

export function ProfileAvatar({
  profile,
  className = "",
  status = true,
}: {
  profile: Profile;
  className?: string;
  status?: boolean;
}) {
  const [failedKey, setFailedKey] = useState<string | undefined>();
  const src = failedKey !== profile.avatarKey ? avatarUrl(profile) : undefined;
  return (
    <span className={`profile-photo ${className}`}>
      {src ? (
        <img
          src={src}
          alt="Фото профиля"
          onError={() => setFailedKey(profile.avatarKey)}
        />
      ) : (
        <span>{profileInitials(profile)}</span>
      )}
      {status && (
        <span
          className={`profile-status-dot status-${profile.jobStatus || "open"}`}
          role="img"
          aria-label={profileStatus(profile)}
          title={profileStatus(profile)}
        />
      )}
    </span>
  );
}
export function ProfileAvatarEditor({
  profile,
  onStateChange,
}: {
  profile: Profile;
  onStateChange: (state: State) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (
      !/^image\/(jpeg|png|webp)$/.test(file.type) ||
      !file.size ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Выберите JPG, PNG или WebP до 5 МБ");
      return;
    }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Не удалось обработать фото");
      ctx.fillStyle = "#f0edfa";
      ctx.fillRect(0, 0, 512, 512);
      const side = Math.min(bitmap.width, bitmap.height);
      ctx.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        512,
        512,
      );
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("Не удалось обработать фото")),
          "image/jpeg",
          0.9,
        ),
      );
      const data = new FormData();
      data.set("file", blob, "avatar.jpg");
      const response = await fetch("/api/avatar", {
        method: "POST",
        body: data,
      });
      const body = (await response.json()) as State & { error?: string };
      if (!response.ok)
        throw new Error(body.error || "Не удалось загрузить фото");
      onStateChange(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function remove() {
    setBusy(true);
    try {
      const response = await fetch("/api/avatar", { method: "DELETE" });
      const body = (await response.json()) as State & { error?: string };
      if (!response.ok) throw new Error(body.error);
      onStateChange(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-photo-editor">
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div>
        <div className="profile-photo-actions">
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? <LogoMotion size={20} /> : <Camera size={18} />}{" "}
            {profile.avatarKey ? "Изменить фото" : "Загрузить фото"}
          </button>
          {profile.avatarKey && (
            <button
              className="btn outline"
              type="button"
              disabled={busy}
              onClick={remove}
            >
              <Trash2 size={16} /> Убрать фото
            </button>
          )}
        </div>
        <p>JPG, PNG или WebP до 5 МБ. Фото обрезается по центру.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Загрузить фото профиля"
        hidden
        onChange={(e) => upload(e.target.files?.[0])}
      />
    </div>
  );
}
