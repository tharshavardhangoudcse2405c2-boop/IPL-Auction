export interface ProviderConfigStatus {
  configured: boolean;
  missing: string[];
}

export class OtpDeliveryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = 'OtpDeliveryError';
    this.code = code;
    this.status = status;
  }
}

function isPlaceholder(value: string): boolean {
  const upper = value.toUpperCase();
  return (
    !value ||
    upper.startsWith('MY_') ||
    upper.startsWith('YOUR_') ||
    upper.startsWith('REPLACE_WITH_') ||
    upper === 'CHANGE_ME' ||
    upper.includes('EXAMPLE.COM') ||
    upper.includes('YOURDOMAIN.COM')
  );
}

export function getEmailProviderStatus(): ProviderConfigStatus {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.EMAIL_FROM || '').trim();
  const missing: string[] = [];

  if (!apiKey || isPlaceholder(apiKey)) {
    missing.push('RESEND_API_KEY');
  }
  if (!from || isPlaceholder(from) || !from.includes('@')) {
    missing.push('EMAIL_FROM');
  }

  return {
    configured: missing.length === 0,
    missing,
  };
}

export function getSmsProviderStatus(): ProviderConfigStatus {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const fromNumber = (process.env.TWILIO_FROM_NUMBER || '').trim();
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const missing: string[] = [];

  if (!accountSid || isPlaceholder(accountSid) || !accountSid.startsWith('AC')) {
    missing.push('TWILIO_ACCOUNT_SID');
  }
  if (!authToken || isPlaceholder(authToken)) {
    missing.push('TWILIO_AUTH_TOKEN');
  }

  const hasValidFrom = Boolean(fromNumber && !isPlaceholder(fromNumber) && /^\+[1-9]\d{6,14}$/.test(fromNumber));
  const hasValidMessagingSid = Boolean(
    messagingServiceSid && !isPlaceholder(messagingServiceSid) && messagingServiceSid.startsWith('MG'),
  );

  if (!hasValidFrom && !hasValidMessagingSid) {
    missing.push('TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID');
  }

  return {
    configured: missing.length === 0,
    missing,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function sendEmailOtp(params: {
  to: string;
  code: string;
  expiresMinutes: number;
}): Promise<void> {
  const status = getEmailProviderStatus();
  if (!status.configured) {
    throw new OtpDeliveryError(
      'EMAIL_NOT_CONFIGURED',
      `Email OTP delivery is not configured on the server yet. Add ${status.missing.join(' and ')} in your Render environment settings.`,
      503,
    );
  }

  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.EMAIL_FROM || '').trim();
  const safeCode = escapeHtml(params.code);

  const textBody = [
    `Your Real Auction 26 login code is: ${params.code}`,
    '',
    `This one-time code expires in ${params.expiresMinutes} minutes and can only be used once.`,
    'If you did not request this login code, you can ignore this email.',
  ].join('\n');

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#131B2B; color:#CFEAE0; padding:32px 20px;">
      <div style="max-width:480px; margin:0 auto; background:#2F4A63; border:1px solid #5B91A3; border-radius:14px; padding:28px;">
        <div style="font-size:12px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#CFEAE0; opacity:0.85;">
          Real Auction 26
        </div>
        <h1 style="margin:10px 0 12px; font-size:22px; color:#FFFFFF;">Your One-Time Login Code</h1>
        <p style="margin:0 0 20px; font-size:14px; line-height:1.5; color:#CFEAE0;">
          Enter this verification code to sign in to Real Auction 26:
        </p>
        <div style="background:#131B2B; border:1px solid #5B91A3; border-radius:10px; padding:16px; text-align:center; font-family:monospace; font-size:30px; font-weight:800; letter-spacing:0.28em; color:#FFFFFF;">
          ${safeCode}
        </div>
        <p style="margin:18px 0 0; font-size:12px; line-height:1.5; color:#CFEAE0; opacity:0.85;">
          This code expires in ${params.expiresMinutes} minutes and can only be used once. If you did not request it, you can safely ignore this message.
        </p>
      </div>
    </div>
  `.trim();

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: 'Your Real Auction 26 login code',
        text: textBody,
        html: htmlBody,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    throw new OtpDeliveryError(
      'EMAIL_DELIVERY_FAILED',
      isTimeout
        ? 'Email delivery timed out while contacting Resend. Please try again.'
        : 'Could not connect to the Resend email service. Please try again shortly.',
      504,
    );
  }

  if (!response.ok) {
    let providerMessage = '';
    try {
      const payload = (await response.json()) as { message?: string; name?: string };
      if (typeof payload.message === 'string') {
        providerMessage = payload.message;
      }
    } catch {
      // Ignore parse error
    }

    if (response.status === 401 || response.status === 403) {
      throw new OtpDeliveryError(
        'EMAIL_PROVIDER_AUTH_ERROR',
        'Resend rejected the server email credentials or sending domain. Verify RESEND_API_KEY and EMAIL_FROM in Render.',
        502,
      );
    }
    if (response.status === 422 || response.status === 400) {
      throw new OtpDeliveryError(
        'EMAIL_DELIVERY_REJECTED',
        providerMessage
          ? `Email delivery failed: ${providerMessage}`
          : 'Email delivery was rejected by Resend. Check EMAIL_FROM domain verification and recipient address.',
        400,
      );
    }
    if (response.status === 429) {
      throw new OtpDeliveryError(
        'EMAIL_RATE_LIMITED',
        'Email provider rate limit reached. Please wait a moment and request a new code.',
        429,
      );
    }

    throw new OtpDeliveryError(
      'EMAIL_DELIVERY_FAILED',
      'Email provider failed to send the verification code. Please try again.',
      502,
    );
  }
}

export async function sendSmsOtp(params: {
  to: string;
  code: string;
  expiresMinutes: number;
}): Promise<void> {
  const status = getSmsProviderStatus();
  if (!status.configured) {
    throw new OtpDeliveryError(
      'SMS_NOT_CONFIGURED',
      `SMS OTP delivery is not configured on the server yet. Add ${status.missing.join(' and ')} in your Render environment settings.`,
      503,
    );
  }

  const accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const fromNumber = (process.env.TWILIO_FROM_NUMBER || '').trim();
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();

  const bodyParams = new URLSearchParams();
  bodyParams.set('To', params.to);
  bodyParams.set(
    'Body',
    `Real Auction 26: Your one-time login code is ${params.code}. It expires in ${params.expiresMinutes} minutes.`,
  );

  if (messagingServiceSid && !isPlaceholder(messagingServiceSid) && messagingServiceSid.startsWith('MG')) {
    bodyParams.set('MessagingServiceSid', messagingServiceSid);
  } else {
    bodyParams.set('From', fromNumber);
  }

  const authHeader = Buffer.from(`${accountSid}:${authToken}`, 'utf8').toString('base64');

  let response: Response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyParams.toString(),
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    throw new OtpDeliveryError(
      'SMS_DELIVERY_FAILED',
      isTimeout
        ? 'SMS delivery timed out while contacting Twilio. Please try again.'
        : 'Could not connect to the Twilio SMS service. Please try again shortly.',
      504,
    );
  }

  if (!response.ok) {
    let twilioCode: number | undefined;
    let twilioMessage = '';
    try {
      const payload = (await response.json()) as { code?: number; message?: string };
      twilioCode = typeof payload.code === 'number' ? payload.code : undefined;
      twilioMessage = typeof payload.message === 'string' ? payload.message : '';
    } catch {
      // Ignore parse errors
    }

    if (response.status === 401 || response.status === 403) {
      throw new OtpDeliveryError(
        'SMS_PROVIDER_AUTH_ERROR',
        'Twilio rejected the server credentials. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Render.',
        502,
      );
    }

    if (twilioCode === 21211 || twilioCode === 21614) {
      throw new OtpDeliveryError(
        'INVALID_PHONE_NUMBER',
        'That phone number could not receive SMS. Check the country code and digits and try again.',
        400,
      );
    }

    if (twilioCode === 21608) {
      throw new OtpDeliveryError(
        'SMS_TRIAL_RESTRICTION',
        'Your Twilio trial account can only send SMS to verified phone numbers in your Twilio console.',
        400,
      );
    }

    if (twilioCode === 21408) {
      throw new OtpDeliveryError(
        'SMS_GEO_DISABLED',
        'SMS delivery to this country is not enabled in your Twilio Geo Permissions settings.',
        400,
      );
    }

    if (twilioCode === 21606 || twilioCode === 21659 || twilioCode === 21704) {
      throw new OtpDeliveryError(
        'SMS_SENDER_INVALID',
        'Twilio rejected the configured sender. Check TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID in Render.',
        502,
      );
    }

    if (response.status === 429) {
      throw new OtpDeliveryError(
        'SMS_RATE_LIMITED',
        'SMS provider rate limit reached. Please wait a moment and try again.',
        429,
      );
    }

    throw new OtpDeliveryError(
      'SMS_DELIVERY_FAILED',
      twilioMessage
        ? `SMS delivery failed: ${twilioMessage}`
        : 'Twilio could not deliver the verification SMS. Please check your configuration and try again.',
      502,
    );
  }
}
