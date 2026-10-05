"use client";
import { useEffect, useState } from "react";
const hashes = new WeakMap<File, Promise<string>>();
export const sourceHash = (file: File) => {
  let result = hashes.get(file);
  if (!result) { result = file.arrayBuffer().then(bytes => crypto.subtle.digest("SHA-256", bytes)).then(bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")); hashes.set(file, result); }
  return result;
};
export function useSourceContext(files: (File | null)[], settings: string) {
  const [value, setValue] = useState<{ files: (File | null)[]; settings: string; fingerprint: string } | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all(files.map(file => file ? sourceHash(file) : null)).then(async values => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ files: values, settings })));
      if (active) setValue({ files, settings, fingerprint: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") });
    }).catch(() => { if (active) setValue(null); });
    return () => { active = false; };
  }, [files, settings]);
  return value?.files === files && value.settings === settings ? value.fingerprint : null;
}
