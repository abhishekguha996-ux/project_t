"use client";

export type LastTokenSnapshot = {
  tokenId: string;
  tokenNumber: number;
  clinicId: string;
  patientName: string;
  doctorName: string;
  phone: string;
  checkedInAt: string;
  savedAt: string;
};

const LATEST_KEY_PREFIX = "qcare:lastToken:latest:";
const PHONE_KEY_PREFIX = "qcare:lastToken:";

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "").trim();
}

function hashPhone(phone: string) {
  let hash = 0;
  for (let index = 0; index < phone.length; index += 1) {
    hash = (hash << 5) - hash + phone.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function buildPhoneScopedKey(clinicId: string, phone: string) {
  const normalizedPhone = normalizePhone(phone);
  return `${PHONE_KEY_PREFIX}${clinicId}:${hashPhone(normalizedPhone)}`;
}

function latestPointerKey(clinicId: string) {
  return `${LATEST_KEY_PREFIX}${clinicId}`;
}

export function saveLastTokenSnapshot(input: Omit<LastTokenSnapshot, "savedAt">) {
  if (typeof window === "undefined") {
    return;
  }

  const snapshot: LastTokenSnapshot = {
    ...input,
    phone: normalizePhone(input.phone),
    savedAt: new Date().toISOString()
  };
  const key = buildPhoneScopedKey(snapshot.clinicId, snapshot.phone);

  window.localStorage.setItem(key, JSON.stringify(snapshot));
  window.localStorage.setItem(latestPointerKey(snapshot.clinicId), key);
}

export function getLastTokenSnapshot(clinicId: string): LastTokenSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  const pointer = window.localStorage.getItem(latestPointerKey(clinicId));
  if (!pointer) {
    return null;
  }

  const rawSnapshot = window.localStorage.getItem(pointer);
  if (!rawSnapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawSnapshot) as LastTokenSnapshot;
    if (!parsed.tokenId || parsed.clinicId !== clinicId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
