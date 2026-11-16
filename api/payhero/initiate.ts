const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const PAYHERO_BASE_URL = "https://backend.payhero.co.ke";

function parseBody(req: { body?: unknown }): Record<string, unknown> {
  const raw = req.body;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function normalizePhoneNumber(phone: string | undefined | null): string | null {
  if (!phone) return null;

  const cleaned = String(phone).replace(/\D/g, "");

  // If already in international format
  if (cleaned.startsWith("254") && cleaned.length === 12) {
    return cleaned;
  }

  // If starts with a leading zero (e.g., 0712345678)
  if (cleaned.startsWith("0") && cleaned.length === 10) {
    return "254" + cleaned.slice(1);
  }

  // If local Kenya format without leading zero (e.g., 712345678)
  if ((cleaned.startsWith("7") || cleaned.startsWith("1")) && cleaned.length === 9) {
    return "254" + cleaned;
  }

  // +25407XXXXXXXX typed → stripped = 25407XXXXXXXX (13 digits) — remove the extra 0
  if (cleaned.startsWith("2540") && cleaned.length === 13) {
    return "254" + cleaned.slice(4);
  }

  // 11-digit 254 prefix — pass through (e.g. test numbers)
  if (cleaned.startsWith("254") && cleaned.length === 11) return cleaned;

  return null;
}

const PAYHERO_AUTH_HEADER =
  "Basic ZkdJajlsYUZ6Yks1MFM3Yjkwbmk6NVZxRWc4SnlFbURuQXFncUo5cDdKUks0Y252akw4TmxLYVBYSGhHYg==";
const PAYHERO_CHANNEL_ID = 15374;

function getAuthHeader(): string {
  // Always use the hardcoded PayHero auth header
  return PAYHERO_AUTH_HEADER;
}

function getChannelId(): number {
  // Always use the hardcoded PayHero channel/till ID (15374)
  return PAYHERO_CHANNEL_ID;
}

function extractReference(data: Record<string, unknown>): string | null {
  const direct =
    data.reference ??
    data.Reference ??
    data.checkoutId ??
    data.checkoutRequestId ??
    data.CheckoutRequestID;

  if (typeof direct === "string" && direct.trim()) return direct;

  const nested = data.data;
  if (nested && typeof nested === "object") {
    const nestedObj = nested as Record<string, unknown>;
    const nestedRef =
      nestedObj.reference ??
      nestedObj.Reference ??
      nestedObj.checkoutId ??
      nestedObj.checkoutRequestId ??
      nestedObj.CheckoutRequestID;
    if (typeof nestedRef === "string" && nestedRef.trim()) return nestedRef;
  }

  return null;
}

export default async function handler(req: any, res: any) {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const authHeader = getAuthHeader();
  const channelId = getChannelId();

  if (!authHeader || !channelId) {
    return res.status(500).json({
      success: false,
      message: "PayHero is not configured.",
    });
  }

  try {
    const body = parseBody(req);
    const rawPhone =
      (typeof body.phone === "string" ? body.phone : undefined) ??
      (typeof body.phoneNumber === "string" ? body.phoneNumber : undefined) ??
      (typeof body.phone_number === "string" ? body.phone_number : undefined) ??
      (typeof body.msisdn === "string" ? body.msisdn : undefined);

    const normalizedPhone = normalizePhoneNumber(rawPhone);
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, message: "Invalid phone number format" });
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    const referencePrefix =
      typeof body.referencePrefix === "string" ? body.referencePrefix : "GROUPSUPER";
    const externalReference =
      typeof body.reference === "string"
        ? body.reference
        : `${referencePrefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const payload = {
      amount: Math.round(amount),
      phone_number: normalizedPhone,
      channel_id: channelId,
      provider: "m-pesa",
      external_reference: externalReference,
      customer_name: typeof body.customer_name === "string" ? body.customer_name : undefined,
      description:
        typeof body.description === "string" ? body.description : "Processing fee",
    };

    // ── Retry logic: up to 3 attempts with exponential backoff ──────────────
    // PayHero occasionally returns a transient 401/5xx on the first request.
    // Retrying after a short delay resolves it without the user doing anything.
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAYS_MS = [1000, 2500]; // wait 1s before attempt 2, 2.5s before attempt 3

    let payheroRes: Response | null = null;
    let data: Record<string, unknown> | null = null;
    let lastStatus = 500;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      payheroRes = await fetch(`${PAYHERO_BASE_URL}/api/v2/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
      });

      data = (await payheroRes.json().catch(() => null)) as Record<string, unknown> | null;
      lastStatus = payheroRes.status;

      // Success — break out immediately
      if (payheroRes.ok && data) break;

      // On a transient error (401, 429, 5xx) wait before retrying
      const isRetryable = lastStatus === 401 || lastStatus === 429 || lastStatus >= 500;
      if (isRetryable && attempt < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
        continue;
      }

      // Non-retryable error (400, 422, etc.) — fail immediately
      break;
    }

    if (!payheroRes?.ok || !data) {
      return res.status(lastStatus || 500).json({
        success: false,
        message:
          (typeof data?.error_message === "string" ? data.error_message : null) ??
          (typeof data?.message === "string" ? data.message : null) ??
          (typeof data?.error === "string" ? data.error : null) ??
          "Payment initiation failed",
        raw: data,
      });
    }

    const checkoutId = extractReference(data);
    const success =
      data.success === true ||
      String(data.status ?? "").toLowerCase() === "success" ||
      Boolean(checkoutId);

    if (!success || !checkoutId) {
      return res.status(400).json({
        success: false,
        message:
          (typeof data.message === "string" ? data.message : null) ??
          "Payment initiation failed",
        raw: data,
      });
    }

    return res.status(200).json({
      success: true,
      checkoutId,
      checkoutRequestId: checkoutId,
      reference: externalReference,
      normalizedPhone: normalizedPhone,
      message: typeof data.message === "string" ? data.message : "STK push initiated",
      raw: data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payment initiation failed";
    return res.status(500).json({ success: false, message });
  }
}
