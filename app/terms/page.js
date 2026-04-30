import Link from 'next/link';
import '../landing.css';
import '../privacy/legal.css';

export const metadata = {
  title: 'Terms of Service — Stock Chatter',
  description:
    'The legal terms governing your use of Stock Chatter. Stock Chatter is an information service — it is not financial advice, and you act on signals at your own risk.',
};

const EFFECTIVE_DATE = 'April 30, 2026';

export default function TermsPage() {
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
          <Link href="/privacy">Privacy</Link>
          <Link href="/login" className="lp-nav-signin">Sign in</Link>
        </nav>
      </header>

      <main className="legal-page">
        <h1>Terms of Service</h1>
        <p className="legal-meta">
          Effective date: {EFFECTIVE_DATE} &middot; Last updated: {EFFECTIVE_DATE}
        </p>

        <div className="legal-callout legal-callout-warn">
          <strong>Read this first.</strong> Stock Chatter is an information and education service
          only. Nothing on this site is investment advice. You can lose money. We accept no
          liability for losses, missed gains, or data issues that result from your use of the
          service. By using Stock Chatter you confirm you have read and accept these terms.
        </div>

        <p className="legal-intro">
          These Terms of Service (&ldquo;Terms&rdquo;) form a binding agreement between you and
          Stock Chatter (a product of FamilyFinance) governing your access to and use of the
          Stock Chatter website, dashboard, email digests, and any related products
          (collectively, the &ldquo;Service&rdquo;). If you do not agree with any part of these
          Terms, do not use the Service.
        </p>

        <h2>1. The service</h2>
        <p>
          Stock Chatter aggregates publicly available market data (SEC filings, FDA catalysts,
          pre-market movers, prediction markets, social-media signals, and more) and uses AI to
          surface tickers our model finds interesting. The Service includes a web dashboard, a
          daily pre-market email digest, and watchlist tools. We continually update the data
          sources, AI models, and features and may change them at any time.
        </p>

        <h2 id="not-advice">2. Not financial advice</h2>
        <div className="legal-callout">
          <p>
            <strong>Stock Chatter is not a registered investment advisor, broker-dealer,
            financial planner, tax advisor, or accountant.</strong> Nothing we publish &mdash;
            on the website, in the dashboard, in emails, or anywhere else &mdash; is personalized
            investment, financial, tax, or legal advice. Every signal, recommendation, entry
            price, target, stop, AI summary, or commentary is provided <em>for informational
            and educational purposes only</em>.
          </p>
          <p>
            Before acting on anything you see here, you should do your own research and consult
            a licensed professional who knows your full financial situation.
          </p>
        </div>

        <h2 id="risk">3. Risk acknowledgement</h2>
        <p>By using the Service, you acknowledge and accept that:</p>
        <ul>
          <li>Trading and investing in securities involve substantial risk, including the risk of <strong>total loss of capital</strong>.</li>
          <li>Stock Chatter focuses heavily on small-cap, biotech, and event-driven names, which carry above-average volatility and risk.</li>
          <li>Past performance, simulated paper-trading results, and back-tests are <strong>not</strong> indicative of future results.</li>
          <li>AI models can be wrong, biased, or behave unpredictably. They can miss important information or overweight irrelevant signals.</li>
          <li>Data sources can be delayed, inaccurate, or unavailable. We use best efforts to validate inputs but make no guarantee of accuracy or completeness.</li>
          <li>Every decision you make &mdash; to buy, sell, hold, size, or hedge &mdash; is yours alone.</li>
        </ul>

        <h2>4. Eligibility &amp; account</h2>
        <p>
          You must be at least 18 years old (or the legal age of majority where you live) to use
          the Service. You agree to provide accurate information when you sign up, to keep your
          login credentials secure, and to notify us promptly if you suspect unauthorised use of
          your account. You are responsible for everything that happens under your account.
        </p>

        <h2>5. Subscription &amp; billing</h2>
        <p>
          Stock Chatter is offered on an annual subscription of <strong>USD $199 per year</strong>{' '}
          (or the equivalent in your local currency, plus any taxes required by your jurisdiction).
          Payments are processed by <strong>Lemon Squeezy</strong> as our merchant of record. By
          subscribing you authorise us, via Lemon Squeezy, to charge the payment method you
          provide.
        </p>
        <p>
          Subscriptions <strong>auto-renew</strong> at the end of each annual period unless you
          cancel before the renewal date. You can cancel at any time from your account or by
          contacting us. Cancellation stops future renewals; access continues until the end of
          the period you have already paid for. We do not generally offer pro-rated refunds for
          cancelled subscriptions, but we will consider exceptional circumstances on a
          case-by-case basis.
        </p>

        <h2>6. Acceptable use</h2>
        <p>You agree <strong>not</strong> to:</p>
        <ul>
          <li>Resell, rebroadcast, or share access to the Service with anyone outside your account.</li>
          <li>Scrape, copy, or systematically extract our content, signals, or AI outputs to build a competing service.</li>
          <li>Reverse-engineer, decompile, or otherwise attempt to derive the underlying source code or models.</li>
          <li>Interfere with the security or integrity of the Service, or use it to send spam, malware, or abusive content.</li>
          <li>Use the Service in any way that violates applicable law or the rights of others.</li>
        </ul>

        <h2>7. Intellectual property</h2>
        <p>
          We own (or licence) all content we publish &mdash; text, code, designs, logos, AI
          outputs, and the Stock Chatter brand itself. We grant you a limited, non-exclusive,
          non-transferable, revocable licence to access and use the Service for your own personal,
          non-commercial use during your subscription. We reserve all other rights.
        </p>
        <p>
          You retain ownership of any notes or content you input. By submitting content to the
          Service you grant us a worldwide, royalty-free licence to host, store, and process that
          content as needed to operate the Service for you.
        </p>

        <h2 id="warranty">8. No warranty &mdash; service provided &ldquo;as-is&rdquo;</h2>
        <p>
          The Service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>{' '}
          without warranties of any kind, whether express, implied, statutory or otherwise. To
          the maximum extent permitted by law, we disclaim all warranties, including any implied
          warranties of merchantability, fitness for a particular purpose, accuracy, completeness,
          quiet enjoyment, and non-infringement.
        </p>
        <p>
          We use commercially reasonable efforts to keep the Service available, secure, and
          accurate, but we do <strong>not</strong> warrant that:
        </p>
        <ul>
          <li>The Service will be uninterrupted, timely, or error-free;</li>
          <li>Signals, prices, AI summaries, or any other data will be accurate, complete, or current;</li>
          <li>The Service will meet your investment goals or financial expectations;</li>
          <li>Defects will be corrected or that data will be preserved without loss.</li>
        </ul>

        <h2 id="liability">9. Limitation of liability</h2>
        <div className="legal-callout">
          <p>
            <strong>To the maximum extent permitted by law, Stock Chatter, FamilyFinance, and our
            officers, directors, employees, contractors, agents, and service providers are not
            liable for:</strong>
          </p>
          <ul>
            <li>Any <strong>investment losses</strong>, missed gains, opportunity costs, or other financial losses, however caused, that arise from your use of (or reliance on) the Service.</li>
            <li>Any <strong>loss, corruption, or unavailability of data</strong>, including watchlists, notes, account history, or emails.</li>
            <li>Any <strong>indirect, incidental, special, consequential, exemplary, or punitive damages</strong>, including lost profits, lost revenue, lost goodwill, business interruption, or substitute services.</li>
            <li>Service interruptions, downtime, third-party outages (Supabase, Vercel, Google, Lemon Squeezy, AI providers), or events outside our reasonable control.</li>
            <li>Decisions you make based on signals, recommendations, AI outputs, charts, or commentary on the Service.</li>
          </ul>
          <p>
            Our total aggregate liability for all claims relating to the Service, regardless of
            the cause of action, is capped at <strong>the lesser of (a) the amount you paid us
            in the 12 months immediately before the event giving rise to the claim, or (b) USD
            $199</strong>.
          </p>
          <p>
            Some jurisdictions do not allow the exclusion or limitation of certain damages, so
            some of the above may not apply to you. In those jurisdictions our liability is
            limited to the smallest extent permitted by law.
          </p>
        </div>

        <h2>10. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless Stock Chatter, FamilyFinance, and our team
          from any claim, loss, liability, or expense (including reasonable legal fees) arising
          from your use of the Service, your breach of these Terms, or your violation of any law
          or third-party rights.
        </p>

        <h2>11. Termination</h2>
        <p>
          You can stop using the Service and cancel your subscription at any time. We can
          suspend or terminate your account if you breach these Terms, attempt to abuse the
          Service, or use it for unlawful purposes. Sections of these Terms that by their nature
          should survive termination &mdash; including disclaimers, limitations of liability,
          indemnities, and intellectual-property provisions &mdash; will continue to apply.
        </p>

        <h2>12. Changes to the service or these terms</h2>
        <p>
          We may update the Service or these Terms from time to time. If we make a material
          change, we will notify active subscribers by email or in-app notice at least 14 days
          before the change takes effect (where reasonably practical). Your continued use of the
          Service after the effective date constitutes acceptance of the updated Terms.
        </p>

        <h2>13. Governing law &amp; disputes</h2>
        <p>
          These Terms are governed by the laws of New South Wales, Australia, without regard to
          its conflict-of-laws principles. Any dispute will be resolved exclusively in the courts
          of New South Wales, Australia, except where applicable consumer law gives you the right
          to bring proceedings elsewhere.
        </p>

        <h2>14. Miscellaneous</h2>
        <p>
          If any part of these Terms is held invalid or unenforceable, the rest will remain in
          effect. Our failure to enforce any provision is not a waiver. You may not assign these
          Terms without our written consent; we may assign them without notice (for example, in
          connection with a merger or sale). These Terms (together with the{' '}
          <Link href="/privacy">Privacy Policy</Link>) are the entire agreement between you and
          us regarding the Service.
        </p>

        <h2>15. Contact</h2>
        <p>
          Questions about these Terms?{' '}
          <a href="mailto:hello@getfamilyfinance.com">hello@getfamilyfinance.com</a>.
        </p>

        <div className="legal-footer-nav">
          <Link href="/privacy">&larr; Privacy Policy</Link>
          <Link href="/">Back to Stock Chatter &rarr;</Link>
        </div>
      </main>
    </div>
  );
}
