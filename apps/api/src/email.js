import { createHash } from "node:crypto";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

export function resendAuthConfigured(environment = process.env) {
  return Boolean(environment.RESEND_API_KEY && environment.RESEND_FROM_EMAIL);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeActionUrl(environment, value) {
  const action = new URL(value);
  const allowedOrigins = new Set(
    [
      environment.BETTER_AUTH_URL,
      environment.PUBLIC_API_URL,
      environment.SITE_URL,
      "http://127.0.0.1:3001",
    ]
      .filter(Boolean)
      .map((url) => new URL(url).origin),
  );
  if (!allowedOrigins.has(action.origin)) {
    throw new Error("Authentication email action URL has an unexpected origin");
  }
  return action.toString();
}

function emailMarkup({
  eyebrow,
  title,
  copy,
  actionLabel,
  actionUrl,
  footer,
  includeAgentSkillsInvite = false,
  closingCopy,
}) {
  const safeUrl = escapeHtml(actionUrl);
  const copyParagraphs = (Array.isArray(copy) ? copy : [copy])
    .map(
      (paragraph, index) =>
        `<p style="margin:${index === 0 ? "18px" : "14px"} 0 0;font-size:15px;line-height:1.7;color:#9ab3a4">${escapeHtml(paragraph)}</p>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
  <body style="margin:0;background:#030706;color:#effff5;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#030706;padding:40px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;overflow:hidden;border:1px solid #244536;border-radius:20px;background:#07100c;box-shadow:0 24px 70px rgba(0,0,0,.45)">
          <tr><td style="height:2px;background:linear-gradient(90deg,#65ff9a,#a8f6ff)"></td></tr>
          <tr><td style="padding:34px 38px 18px">
            <div style="font-size:14px;font-weight:700;letter-spacing:.2em;color:#effff5">POSTER<span style="color:#65ff9a">RACT</span></div>
            <div style="margin-top:36px;font-family:monospace;font-size:11px;letter-spacing:.12em;color:#65ff9a;text-transform:uppercase">${escapeHtml(eyebrow)}</div>
            <h1 style="margin:12px 0 0;font-size:34px;line-height:1.08;letter-spacing:-.04em;color:#effff5">${escapeHtml(title)}</h1>
            ${copyParagraphs}
            ${
              includeAgentSkillsInvite
                ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.7;color:#9ab3a4">You can use my <strong style="color:#effff5">AI Agent Content Skill folders</strong> from <a href="https://aiforsavages.fyi" style="color:#65ff9a;text-decoration:none">AI for Savages</a> and join my Discord for help.</p>`
                : ""
            }
            ${
              closingCopy
                ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.7;color:#9ab3a4">${escapeHtml(closingCopy)}</p>`
                : ""
            }
          </td></tr>
          <tr><td style="padding:14px 38px 24px">
            <a href="${safeUrl}" style="display:block;padding:16px 22px;border-radius:10px;background:linear-gradient(100deg,#65ff9a,#a8f6ff);color:#031008;font-family:monospace;font-size:12px;font-weight:700;letter-spacing:.08em;text-align:center;text-decoration:none;text-transform:uppercase">${escapeHtml(actionLabel)}</a>
          </td></tr>
          <tr><td style="padding:0 38px 34px">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#60796a">${escapeHtml(footer)}</p>
            <p style="margin:16px 0 0;word-break:break-all;font-size:10px;line-height:1.5;color:#405448">${safeUrl}</p>
          </td></tr>
        </table>
        <p style="margin:18px 0 0;font-size:11px;color:#52695a">Posterract · One signal, every platform.</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function dispatchFailure(error) {
  const message = error instanceof Error ? error.message : "Unknown email delivery error";
  console.error(`[auth-email] ${message}`);
}

export function createResendAuthMailer({
  environment = process.env,
  fetchImplementation = globalThis.fetch,
} = {}) {
  if (!resendAuthConfigured(environment)) {
    throw new Error("Resend authentication email configuration is incomplete");
  }

  const send = async ({ kind, token, to, subject, text, html }) => {
    const digest = createHash("sha256")
      .update(`${kind}:${token}`)
      .digest("hex");
    const response = await fetchImplementation(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `posterract-${kind}-${digest}`,
      },
      body: JSON.stringify({
        from: environment.RESEND_FROM_EMAIL,
        to: [to],
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Resend authentication email request failed (${response.status})`);
    }
  };

  return {
    sendVerification({ user, url, token }) {
      const actionUrl = safeActionUrl(environment, url);
      const name = user.name?.trim() || "there";
      return send({
        kind: "verify",
        token,
        to: user.email,
        subject: "Verify your Posterract email",
        text: `Hi ${name}, verify your Posterract email: ${actionUrl}\n\nThis link expires in one hour. If you did not create this account, ignore this email.`,
        html: emailMarkup({
          eyebrow: "Identity confirmation // 01",
          title: "Verify your signal.",
          copy: `Hi ${name}. Confirm this email address to activate your Posterract workspace.`,
          actionLabel: "Verify email",
          actionUrl,
          footer: "This secure link expires in one hour. If you did not create a Posterract account, you can safely ignore this email.",
        }),
      });
    },

    sendPasswordReset({ user, url, token }) {
      const actionUrl = safeActionUrl(environment, url);
      const name = user.name?.trim() || "there";
      return send({
        kind: "reset",
        token,
        to: user.email,
        subject: "Reset your Posterract password",
        text: `Hi ${name}, reset your Posterract password: ${actionUrl}\n\nThis link expires in one hour. If you did not request this, ignore this email.`,
        html: emailMarkup({
          eyebrow: "Credential recovery // 02",
          title: "Reset your access.",
          copy: `Hi ${name}. Use the secure link below to choose a new Posterract password.`,
          actionLabel: "Reset password",
          actionUrl,
          footer: "This secure link expires in one hour. If you did not request a password reset, no action is required.",
        }),
      });
    },

    sendSignInLink({ user, url, token }) {
      const actionUrl = safeActionUrl(environment, url);
      const name = user.name?.trim() || "there";
      return send({
        kind: "signin",
        token,
        to: user.email,
        subject: "Your Posterract sign-in link",
        text: `Hi ${name}, use this secure link to sign in to Posterract: ${actionUrl}\n\nThis single-use link expires in 15 minutes. If you did not request it, ignore this email.`,
        html: emailMarkup({
          eyebrow: "Secure sign-in // 04",
          title: "Return to Posterract.",
          copy: `Hi ${name}. Use the secure link below to sign in and continue where you left off.`,
          actionLabel: "Sign in to Posterract",
          actionUrl,
          footer:
            "This single-use link expires in 15 minutes. If you did not request it, you can safely ignore this email.",
        }),
      });
    },

    sendWelcome({ user, userId }) {
      const actionUrl = safeActionUrl(
        environment,
        environment.SITE_URL ??
          environment.BETTER_AUTH_URL ??
          environment.PUBLIC_API_URL ??
          "http://127.0.0.1:3001",
      );
      const name = user.name?.trim() || "there";
      return send({
        kind: "welcome",
        token: userId,
        to: user.email,
        subject: "Welcome to Posterract",
        text: `Welcome, ${name}.\n\nYou and your agent are ready to use Posterract.\n\nConnect your socials. Create an API key and give it to your agent. Start creating content.\n\nYou can use my AI Agent Content Skill folders from AI for Savages (https://aiforsavages.fyi) and join my Discord for help.\n\nStart posting and scheduling content with your agent.\n\nOpen Posterract: ${actionUrl}\n\nYou are receiving this one-time email because your Posterract account was successfully activated.`,
        html: emailMarkup({
          eyebrow: "Workspace activated // 03",
          title: `Welcome, ${name}.`,
          copy: [
            "You and your agent are ready to use Posterract.",
            "Connect your socials. Create an API key and give it to your agent. Start creating content.",
          ],
          actionLabel: "Open Posterract",
          actionUrl,
          footer:
            "You are receiving this one-time email because your Posterract account was successfully activated.",
          includeAgentSkillsInvite: true,
          closingCopy:
            "Start posting and scheduling content with your agent.",
        }),
      });
    },
  };
}

export function dispatchAuthEmail(delivery) {
  void delivery.catch(dispatchFailure);
}
