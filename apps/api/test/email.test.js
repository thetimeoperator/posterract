import assert from "node:assert/strict";
import test from "node:test";
import {
  createResendAuthMailer,
  resendAuthConfigured,
} from "../src/email.js";

const environment = {
  BETTER_AUTH_URL: "https://www.posterract.app",
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM_EMAIL: "Posterract <security@posterract.app>",
};

test("Resend auth mailer sends branded, idempotent verification email", async () => {
  let request;
  const mailer = createResendAuthMailer({
    environment,
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: "email_test" }), { status: 200 });
    },
  });

  await mailer.sendVerification({
    user: { email: "creator@example.test", name: "Creator" },
    token: "verification-token",
    url: "https://www.posterract.app/api/auth/verify-email?token=verification-token",
  });

  assert.equal(request.url, "https://api.resend.com/emails");
  assert.match(request.options.headers["Idempotency-Key"], /^posterract-verify-/);
  const body = JSON.parse(request.options.body);
  assert.equal(body.from, environment.RESEND_FROM_EMAIL);
  assert.deepEqual(body.to, ["creator@example.test"]);
  assert.match(body.subject, /Verify your Posterract email/);
  assert.match(body.html, /Verify email/);
  assert.doesNotMatch(body.html, /re_test_key/);
});

test("Resend auth mailer rejects action links outside the auth origin", () => {
  const mailer = createResendAuthMailer({
    environment,
    fetchImplementation: async () => new Response(null, { status: 200 }),
  });
  assert.throws(
    () =>
      mailer.sendPasswordReset({
        user: { email: "creator@example.test", name: "Creator" },
        token: "reset-token",
        url: "https://attacker.example/reset?token=reset-token",
      }),
    /unexpected origin/,
  );
});

test("Resend auth mailer sends a distinct, short-lived sign-in link", async () => {
  let request;
  const mailer = createResendAuthMailer({
    environment,
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: "email_signin" }), { status: 200 });
    },
  });

  await mailer.sendSignInLink({
    user: { email: "creator@example.test", name: "Creator" },
    token: "sign-in-token",
    url: "https://www.posterract.app/api/auth/magic-link/verify?token=sign-in-token",
  });

  const body = JSON.parse(request.options.body);
  assert.match(request.options.headers["Idempotency-Key"], /^posterract-signin-/);
  assert.equal(body.subject, "Your Posterract sign-in link");
  assert.match(body.html, /Sign in to Posterract/);
  assert.match(body.text, /single-use link expires in 15 minutes/);
  assert.doesNotMatch(body.html, /Verify your signal/);
});

test("Resend auth mailer sends the one-time welcome message and skills link", async () => {
  let request;
  const mailer = createResendAuthMailer({
    environment: { ...environment, SITE_URL: "https://www.posterract.app" },
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: "email_welcome" }), { status: 200 });
    },
  });

  await mailer.sendWelcome({
    user: { email: "creator@example.test", name: "Creator" },
    userId: "00000000-0000-4000-8000-000000000001",
  });

  const body = JSON.parse(request.options.body);
  assert.match(request.options.headers["Idempotency-Key"], /^posterract-welcome-/);
  assert.equal(body.subject, "Welcome to Posterract");
  assert.match(body.html, /Welcome, Creator\./);
  assert.match(body.html, /ready to use Posterract/);
  assert.match(body.html, /Create an API key and give it to your agent/);
  assert.match(body.html, /href="https:\/\/aiforsavages\.fyi"/);
  assert.match(
    body.text,
    /AI Agent Content Skill folders from AI for Savages/,
  );
  assert.match(body.text, /Start posting and scheduling content with your agent/);
  assert.ok(
    body.text.indexOf("AI Agent Content Skill folders") <
      body.text.indexOf("You are receiving this one-time email"),
  );
});

test("Resend auth configuration requires both key and sender", () => {
  assert.equal(resendAuthConfigured(environment), true);
  assert.equal(resendAuthConfigured({ RESEND_API_KEY: "re_test" }), false);
  assert.equal(
    resendAuthConfigured({ RESEND_FROM_EMAIL: environment.RESEND_FROM_EMAIL }),
    false,
  );
});
