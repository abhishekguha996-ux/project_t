import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { MessageDeliveryStatus, MessageType } from "@/lib/utils/types";

type NotificationEvent =
  | "checkin_confirm"
  | "your_turn"
  | "consult_complete"
  | "skipped_noshow"
  | "stepped_out_check";

type TokenNotificationContext = {
  token_id: string;
  token_number: number;
  patient_phone: string;
  patient_name: string | null;
  doctor_name: string | null;
  clinic_name: string | null;
};

type DeliveryChannel = "whatsapp" | "sms";

type DeliveryAttemptResult = {
  ok: boolean;
  channel: DeliveryChannel;
  providerResponseId: string | null;
  deliveryStatus: MessageDeliveryStatus;
  error: string | null;
};

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "").trim();
}

function toE164(phone: string, defaultCountryCode: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("+")) {
    return normalized;
  }

  const digits = normalized.replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  if (digits.length === 10) {
    return `${defaultCountryCode}${digits}`;
  }

  return `+${digits}`;
}

function toWhatsAppAddress(value: string) {
  return value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
}

function formatMessageBody(event: NotificationEvent, context: TokenNotificationContext) {
  const patientName = context.patient_name?.trim() || "Patient";
  const doctorName = context.doctor_name?.trim() || "your doctor";
  const clinicName = context.clinic_name?.trim() || "your clinic";
  const tokenText = `Token #${context.token_number}`;

  if (event === "checkin_confirm") {
    return `${clinicName}: ${patientName}, check-in confirmed. ${tokenText} is in waiting queue with ${doctorName}.`;
  }

  if (event === "your_turn") {
    return `${clinicName}: ${tokenText}, it is your turn with ${doctorName}. Please proceed now.`;
  }

  if (event === "consult_complete") {
    return `${clinicName}: ${tokenText} consultation is marked complete. Thank you for visiting.`;
  }

  if (event === "skipped_noshow") {
    return `${clinicName}: ${tokenText} was marked skipped. Please contact reception to rejoin queue.`;
  }

  return `${clinicName}: ${tokenText} is in Hold slot temporarily. Please check with reception before your turn.`;
}

async function writeMessageLog(params: {
  supabase: SupabaseClient;
  tokenId: string;
  patientPhone: string;
  messageType: MessageType;
  messageBody: string;
  twilioSid: string | null;
  deliveryStatus: MessageDeliveryStatus;
}) {
  const { error } = await params.supabase.from("message_log").insert({
    token_id: params.tokenId,
    patient_phone: params.patientPhone,
    message_type: params.messageType,
    message_body: params.messageBody,
    twilio_sid: params.twilioSid,
    delivery_status: params.deliveryStatus
  });

  if (error) {
    console.error("[QCare] Failed to write message log:", error.message);
  }
}

async function sendTwilioMessage(params: {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  body: string;
  channel: DeliveryChannel;
}): Promise<DeliveryAttemptResult> {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/Messages.json`;
  const authHeader = Buffer.from(`${params.accountSid}:${params.authToken}`).toString(
    "base64"
  );

  const form = new URLSearchParams();
  form.set("From", params.from);
  form.set("To", params.to);
  form.set("Body", params.body);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });

    const payload = (await response.json().catch(() => null)) as {
      sid?: string;
      message?: string;
    } | null;

    if (!response.ok) {
      return {
        ok: false,
        channel: params.channel,
        providerResponseId: payload?.sid ?? null,
        deliveryStatus: "failed",
        error: payload?.message ?? `Twilio returned HTTP ${response.status}.`
      };
    }

    return {
      ok: true,
      channel: params.channel,
      providerResponseId: payload?.sid ?? null,
      deliveryStatus: "sent",
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      channel: params.channel,
      providerResponseId: null,
      deliveryStatus: "failed",
      error: error instanceof Error ? error.message : "Failed to call Twilio."
    };
  }
}

async function loadTokenContext(
  supabase: SupabaseClient,
  tokenId: string
): Promise<TokenNotificationContext | null> {
  const { data, error } = await supabase
    .from("tokens")
    .select(
      "id, token_number, patients(phone, name), doctors(name), clinics(name)"
    )
    .eq("id", tokenId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const token = data as {
    id: string;
    token_number: number;
    patients: { phone?: string | null; name?: string | null } | null;
    doctors: { name?: string | null } | null;
    clinics: { name?: string | null } | null;
  };
  const patientPhone = token.patients?.phone ? normalizePhone(token.patients.phone) : "";

  if (!patientPhone) {
    return null;
  }

  return {
    token_id: token.id,
    token_number: token.token_number,
    patient_phone: patientPhone,
    patient_name: token.patients?.name ?? null,
    doctor_name: token.doctors?.name ?? null,
    clinic_name: token.clinics?.name ?? null
  };
}

export async function notifyPatientStatusUpdate(params: {
  tokenId: string;
  event: NotificationEvent;
  supabase?: SupabaseClient;
}) {
  const env = getServerEnv();
  const supabase = params.supabase ?? getSupabaseServiceRoleClient();
  const context = await loadTokenContext(supabase, params.tokenId);

  if (!context) {
    return;
  }

  const messageBody = formatMessageBody(params.event, context);
  const defaultCountryCode = env.QCARE_DEFAULT_PHONE_COUNTRY_CODE || "+91";
  const patientTo = toE164(context.patient_phone, defaultCountryCode);

  if (!patientTo) {
    return;
  }

  const notificationsEnabled = env.QCARE_NOTIFICATIONS_ENABLED;
  const canCallTwilio =
    notificationsEnabled &&
    env.QCARE_NOTIFICATION_MODE === "live" &&
    Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
  const attempts: DeliveryAttemptResult[] = [];

  if (!canCallTwilio) {
    attempts.push({
      ok: false,
      channel: "whatsapp",
      providerResponseId: null,
      deliveryStatus: "undelivered",
      error:
        "Notification delivery skipped. Configure Twilio and set QCARE_NOTIFICATION_MODE=live."
    });
  } else {
    if (env.QCARE_WHATSAPP_FROM) {
      const whatsappAttempt = await sendTwilioMessage({
        accountSid: env.TWILIO_ACCOUNT_SID as string,
        authToken: env.TWILIO_AUTH_TOKEN as string,
        from: toWhatsAppAddress(env.QCARE_WHATSAPP_FROM),
        to: toWhatsAppAddress(patientTo),
        body: messageBody,
        channel: "whatsapp"
      });
      attempts.push(whatsappAttempt);
    } else {
      attempts.push({
        ok: false,
        channel: "whatsapp",
        providerResponseId: null,
        deliveryStatus: "undelivered",
        error: "Missing QCARE_WHATSAPP_FROM sender."
      });
    }

    if (!attempts.some((attempt) => attempt.channel === "whatsapp" && attempt.ok)) {
      if (env.QCARE_SMS_FROM) {
        const smsAttempt = await sendTwilioMessage({
          accountSid: env.TWILIO_ACCOUNT_SID as string,
          authToken: env.TWILIO_AUTH_TOKEN as string,
          from: env.QCARE_SMS_FROM,
          to: patientTo,
          body: messageBody,
          channel: "sms"
        });
        attempts.push(smsAttempt);
      } else {
        attempts.push({
          ok: false,
          channel: "sms",
          providerResponseId: null,
          deliveryStatus: "undelivered",
          error: "Missing QCARE_SMS_FROM sender."
        });
      }
    }
  }

  const messageType: MessageType =
    params.event === "consult_complete" ? "consult_complete" : params.event;

  for (const attempt of attempts) {
    await writeMessageLog({
      supabase,
      tokenId: context.token_id,
      patientPhone: context.patient_phone,
      messageType,
      messageBody: `[channel:${attempt.channel}] ${messageBody}`,
      twilioSid: attempt.providerResponseId,
      deliveryStatus: attempt.deliveryStatus
    });

    if (!attempt.ok && attempt.error) {
      console.error(
        `[QCare] ${attempt.channel} notification failed for token ${context.token_number}: ${attempt.error}`
      );
    }
  }
}
