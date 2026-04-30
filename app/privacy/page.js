import Link from 'next/link';
import '../landing.css';
import './legal.css';

export const metadata = {
  title: 'Privacy Policy — Stock Chatter',
  description:
    'How Stock Chatter collects, uses, and protects your personal information. We use industry-standard practices and only the data necessary to deliver the service.',
};

const EFFECTIVE_DATE = 'April 30, 2026';

export default function PrivacyPage() {
  return (
    <div className="lp-root legal-root">
      {/* ─── Top nav (matches landing) ─── */}
      <header className="lp-nav">
        <Link className="lp-logo" href="/">
          <img src="/logo-sm.png" alt="Stock Chatter" className="lp-logo-mark" width="32" height="32" />
          <span className="lp-logo-text">Stock <span>Chatter</span></span>
        </Link>
        <nav className="lp-nav-links">
          <Link href="/">Home</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/login" className="lp-nav-signin">Sign in</Link>
        </nav>
      </header>

      <main className="legal-page">
        <h1>Privacy Policy</h1>
        <p className="legal-meta">
          Effective date: {EFFECTIVE_DATE} &middot; Last updated: {EFFECTIVE_DATE}
        </p>

        <p className="legal-intro">
          Stock Chatter (&ldquo;Stock Chatter,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;)
          respects your privacy. This Privacy Policy explains what information we collect, how we use it,
          who we share it with, and the choices you have. By creating an account or using our service,
          you agree to the practices described here.
        </p>

        <h2>1. Who we are</h2>
        <p>
          Stock Chatter is an AI-first stock-signal information service operated as a product of
          FamilyFinance. You can contact us any time at{' '}
          <a href="mailto:hello@getfamilyfinance.com">hello@getfamilyfinance.com</a>.
        </p>

        <h2>2. Information we collect</h2>
        <p>We collect only what we need to run the service. Specifically:</p>
        <ul>
          <li>
            <strong>Account information.</strong> When you sign in with Google, we receive your name,
            email address, and Google profile picture from Google&rsquo;s OAuth service. We do not see
            or store your Google password.
          </li>
          <li>
            <strong>Subscription and billing information.</strong> Payment for our AUD $199/year
            subscription is processed by <strong>Lemon Squeezy</strong>, an independent merchant of
            record. We never see or store your credit card number, CVV, or full bank details. We
            receive only a subscription status (active / cancelled), the email used at checkout, and
            a billing reference ID.
          </li>
          <li>
            <strong>Service data.</strong> We store your watchlist, AI scan settings (such as your
            preferred market-cap range), notes you save against tickers, and your email-notification
            preferences.
          </li>
          <li>
            <strong>Usage and technical data.</strong> Our hosting and analytics providers may log
            standard request metadata such as IP address, browser type, device type, pages visited,
            and timestamps. This is used to keep the service secure and reliable.
          </li>
          <li>
            <strong>Communications.</strong> If you email us, we keep that correspondence so we can
            respond and improve our support.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> collect Social Security numbers, government IDs, brokerage
          account numbers, or any data linked to your real-world investment activity.
        </p>

        <h2>3. How we use your information</h2>
        <ul>
          <li>To create and operate your account, including authentication and admin approval.</li>
          <li>To deliver the daily pre-market digest and any in-app notifications you have opted into.</li>
          <li>To process your subscription via our payment provider and reflect your access level.</li>
          <li>To improve the AI scan, debug issues, and protect the service from abuse.</li>
          <li>To respond to questions, support requests, or legal obligations.</li>
        </ul>

        <h2>4. Who we share information with</h2>
        <p>
          We do not sell your personal information. We share it only with vetted third-party service
          providers that help us run Stock Chatter:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> &mdash; managed Postgres database and authentication.
          </li>
          <li>
            <strong>Vercel</strong> &mdash; application hosting and content delivery.
          </li>
          <li>
            <strong>Google</strong> &mdash; sign-in via Google OAuth.
          </li>
          <li>
            <strong>Lemon Squeezy</strong> &mdash; subscription payments and tax compliance.
          </li>
          <li>
            <strong>Email delivery providers</strong> (e.g. Gmail SMTP) &mdash; to send the
            pre-market digest and account notifications.
          </li>
          <li>
            <strong>AI providers</strong> &mdash; we may send anonymised market and ticker data to
            third-party AI models to generate signals. We do not share your personal account data
            (name, email, watchlist) with these providers.
          </li>
        </ul>
        <p>
          We may also disclose information when required by law, to enforce our Terms of Service, or
          to protect the rights, property, or safety of Stock Chatter, our users, or the public.
        </p>

        <h2>5. Cookies and similar technologies</h2>
        <p>
          We use only the cookies strictly necessary to keep you signed in and to remember basic
          preferences. We do not use third-party advertising cookies. If your browser blocks
          cookies, parts of the service may not work.
        </p>

        <h2>6. Data retention</h2>
        <p>
          We retain your account data for as long as your account is active. If you cancel, we
          retain a minimal record (email, cancellation date, billing reference) for up to 7 years
          to meet tax and accounting obligations. You can request earlier deletion of personal data
          (subject to those obligations) by emailing us.
        </p>

        <h2>7. Security</h2>
        <p>
          We use industry-standard practices to protect your data: encrypted connections (HTTPS),
          encrypted database storage, row-level security, and least-privilege access for our team.
          No system is perfectly secure, and we cannot guarantee absolute security. If we ever
          experience a security incident affecting your data, we will notify you as required by
          applicable law.
        </p>

        <h2>8. Your rights</h2>
        <p>
          Depending on where you live, you may have rights to access, correct, export, or delete
          your personal information, to object to or restrict certain processing, and to withdraw
          consent. To exercise any of these rights, email{' '}
          <a href="mailto:hello@getfamilyfinance.com">hello@getfamilyfinance.com</a>. We will respond within
          30 days.
        </p>
        <p>
          You can unsubscribe from the daily digest at any time using the one-click unsubscribe
          link at the bottom of every email, or by changing your email preferences in the app.
        </p>

        <h2>9. International data transfers</h2>
        <p>
          Stock Chatter is operated from Australia. Our service providers (Supabase, Vercel, Google,
          Lemon Squeezy) may store and process data in the United States and other regions. We
          rely on standard contractual clauses and provider-level safeguards to protect that data
          in transit and at rest.
        </p>

        <h2>10. Children</h2>
        <p>
          Stock Chatter is not directed at children under 16 and we do not knowingly collect
          personal information from anyone under that age. If you believe a child has signed up,
          contact us and we will delete the account.
        </p>

        <h2>11. Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time. The &ldquo;Last updated&rdquo; date
          at the top of this page reflects the most recent revision. If we make material changes,
          we will notify active subscribers by email.
        </p>

        <h2>12. Contact us</h2>
        <p>
          Questions or requests regarding privacy?{' '}
          <a href="mailto:hello@getfamilyfinance.com">hello@getfamilyfinance.com</a>.
        </p>

        <div className="legal-footer-nav">
          <Link href="/">&larr; Back to Stock Chatter</Link>
          <Link href="/terms">Terms of Service &rarr;</Link>
        </div>
      </main>
    </div>
  );
}
