'use client';
import { useEffect, useState } from 'react';
import './globals.css';
import './landing.css';

/**
 * Stock Chatter — public marketing landing page.
 * Lives at the root URL `/`. Existing dashboard auth flow is unchanged:
 *   /login   → Google OAuth sign-in
 *   /dashboard → gated by profiles.status='approved'
 *   /pending → waiting room
 *
 * The "Start — $199/yr" CTA opens Lemon Squeezy checkout. The Lemon Squeezy
 * webhook (/api/webhooks/lemonsqueezy) flips profiles.status='approved' on
 * successful payment so the user gets straight in after Google OAuth.
 */

const CHECKOUT_URL = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL || '';

export default function LandingPage() {
  const [authState, setAuthState] = useState({ loading: true, status: null });

  // If the visitor already has a session, adapt the CTAs (don't make
  // returning paid users go through the marketing funnel).
  useEffect(() => {
    fetch('/api/profile', { cache: 'no-store' })
      .then(res => (res.status === 401 ? null : res.json()))
      .then(data => {
        setAuthState({ loading: false, status: data?.profile?.status || null });
      })
      .catch(() => setAuthState({ loading: false, status: null }));
  }, []);

  // Inject the Lemon Squeezy overlay script once the page mounts.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (document.getElementById('lemonsqueezy-script')) return;
    const s = document.createElement('script');
    s.id = 'lemonsqueezy-script';
    s.src = 'https://app.lemonsqueezy.com/js/lemon.js';
    s.defer = true;
    s.onload = () => { try { window.createLemonSqueezy?.(); } catch {} };
    document.body.appendChild(s);
  }, []);

  const ctaHref = CHECKOUT_URL ? `${CHECKOUT_URL}${CHECKOUT_URL.includes('?') ? '&' : '?'}embed=1` : '#waitlist';
  const ctaLabel = !CHECKOUT_URL ? 'Get notified at launch' :
    authState.status === 'approved' ? 'Go to your dashboard →' :
    authState.status === 'pending' ? 'Check your approval status' :
    'Start — $199/year';
  const ctaTarget = authState.status === 'approved' ? '/dashboard'
    : authState.status === 'pending' ? '/pending'
    : ctaHref;
  const ctaIsCheckout = CHECKOUT_URL && !authState.status;

  return (
    <div className="lp-root">
      {/* ───────────────────────── Top nav ───────────────────────── */}
      <header className="lp-nav">
        <a className="lp-logo" href="/">
          <span className="lp-logo-mark">S</span>
          <span className="lp-logo-text">Stock <span>Chatter</span></span>
        </a>
        <nav className="lp-nav-links">
          <a href="#how">How it works</a>
          <a href="#tour">Product</a>
          <a href="#sources">Sources</a>
          <a href="#proof">Results</a>
          <a href="#faq">FAQ</a>
          <a href="/login" className="lp-nav-signin">Sign in</a>
        </nav>
      </header>

      {/* ─────────────────────────── Hero ─────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <div className="lp-eyebrow">
              <span className="lp-pulse" /> AI-first stock signals · live now
            </div>
            <h1>
              Catch the move <span className="lp-grad">before</span> it happens.
            </h1>
            <p className="lp-hero-sub">
              Stock Chatter is an always-on AI scanner that fuses 10 leading-indicator
              sources &mdash; SEC 8-Ks, FDA catalysts, pre-market movers, Reddit chatter,
              prediction markets &mdash; and turns the noise into a daily watchlist with
              entry, target, and stop on every pick.
            </p>

            <div className="lp-cta-row">
              <a
                className={`lp-btn lp-btn-primary ${ctaIsCheckout ? 'lemonsqueezy-button' : ''}`}
                href={ctaTarget}
                rel={ctaIsCheckout ? 'nofollow' : undefined}
              >
                {ctaLabel}
              </a>
              <a className="lp-btn lp-btn-ghost" href="#how">See how it works</a>
            </div>

            <div className="lp-trust-row">
              <div className="lp-trust-item"><strong>10</strong><span>signal sources</span></div>
              <div className="lp-trust-item"><strong>5-state</strong><span>AI engine</span></div>
              <div className="lp-trust-item"><strong>Pre-market</strong><span>daily digest</span></div>
            </div>
          </div>

          {/* Live mockup of a real signal card */}
          <div className="lp-hero-card-wrap" aria-hidden="true">
            <div className="lp-phone">
              <div className="lp-phone-notch" />
              <div className="lp-phone-screen">
                <SignalCardMockup
                  ticker="TOVX"
                  company="Theriva Biologics"
                  rec="BUY"
                  price="$3.42"
                  todayPct="+8.4%"
                  fromPrice="2.95"
                  lifetimePct="+15.9%"
                  entry="2.95 – 3.10"
                  target="3.85 – 4.40"
                  stop="2.78"
                  aiRead="FDA catalyst in 11 days + 4× WSB rank delta. Volume 2.1× avg. Entry still in range."
                  source="FDA catalyst"
                  glow
                />
              </div>
            </div>
            <div className="lp-floating-pill lp-fp-1">
              <span className="lp-pulse" /> WSB mention spike +180%
            </div>
            <div className="lp-floating-pill lp-fp-2">
              SEC 8-K filed 11 min ago
            </div>
            <div className="lp-floating-pill lp-fp-3">
              Pre-market +6.8%
            </div>
          </div>
        </div>
      </section>

      {/* ───────── "Why it's different" — comparison strip ───────── */}
      <section className="lp-section lp-compare-section">
        <h2 className="lp-section-title">Most apps tell you what already happened.</h2>
        <p className="lp-section-sub">Stock Chatter tells you what&rsquo;s about to.</p>

        <div className="lp-compare-grid">
          <div className="lp-compare-col lp-compare-them">
            <div className="lp-compare-tag lp-tag-them">Everyone else</div>
            <h3>Lagging price charts</h3>
            <ul>
              <li>You see a stock&rsquo;s already moved 30%</li>
              <li>One generic newsletter pick a week</li>
              <li>No entry, no stop, no exit plan</li>
              <li>Buried catalysts and SEC filings</li>
              <li>You&rsquo;re always the last to know</li>
            </ul>
          </div>
          <div className="lp-compare-col lp-compare-us">
            <div className="lp-compare-tag lp-tag-us">Stock Chatter</div>
            <h3>Leading-indicator AI</h3>
            <ul>
              <li>Scans 10 sources every 30 minutes</li>
              <li>Anti-surge filter: never chases +20% moves</li>
              <li>Entry / target / stop on every pick</li>
              <li>Pre-market FDA, 8-K &amp; pre-market mover digest</li>
              <li>Plain-English AI Read on every signal</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ─────────────── How it works (3-step flow) ─────────────── */}
      <section id="how" className="lp-section">
        <h2 className="lp-section-title">How Stock Chatter works</h2>
        <p className="lp-section-sub">
          Three steps, fully automated, running while you sleep.
        </p>

        <div className="lp-how-grid">
          <div className="lp-how-step">
            <div className="lp-how-num">1</div>
            <h3>We scan everything</h3>
            <p>
              Every 30 minutes during market hours, our scanner pulls fresh data
              from 10 independent signal sources &mdash; from SEC filings to
              wallstreetbets to FDA catalysts.
            </p>
          </div>
          <div className="lp-how-step">
            <div className="lp-how-num">2</div>
            <h3>AI scores &amp; filters</h3>
            <p>
              Our engine cross-checks momentum, volume, catalysts and chatter,
              throws out anything already up 20% the same day, and assigns one
              of five recommendation states.
            </p>
          </div>
          <div className="lp-how-step">
            <div className="lp-how-num">3</div>
            <h3>You get the watchlist</h3>
            <p>
              A pre-market email digest at 9:00 AM ET. A market-open recap at
              10:30 AM. And a Robinhood-style mobile dashboard you can open
              anytime, anywhere.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────── Product tour (4 phone screens) ─────────────── */}
      <section id="tour" className="lp-section lp-tour-section">
        <h2 className="lp-section-title">Built for your phone, not a Bloomberg terminal</h2>
        <p className="lp-section-sub">
          Every pick, every chart, every chip is thumb-reachable. Open it on the
          train and you&rsquo;re in the same flow as on your laptop.
        </p>

        <div className="lp-tour-grid">
          <TourPhone caption="Mobile feed with 5-tab bottom nav. Tap to filter to Active, your Watchlist, your Portfolio, or the Leaderboard.">
            <MobileFeedMockup />
          </TourPhone>

          <TourPhone caption="Every pick gets a 3-month chart with entry, target and stop lines drawn on. See exactly where you are in the trade.">
            <ChartDetailMockup />
          </TourPhone>

          <TourPhone caption="Paper-trade every signal with virtual cash. Build a portfolio, learn the system, then go live with confidence.">
            <PortfolioMockup />
          </TourPhone>

          <TourPhone caption="Full reporting on what we held. Every BUY signal tracked end-to-end with its real outcome &mdash; not just the winners.">
            <ReportingMockup />
          </TourPhone>
        </div>
      </section>

      {/* ─────────────── The 10 sources (the moat) ─────────────── */}
      <section id="sources" className="lp-section lp-sources-section">
        <h2 className="lp-section-title">10 signal sources, fused into one watchlist</h2>
        <p className="lp-section-sub">
          The leading indicators institutional desks watch &mdash; finally available to retail.
        </p>

        <div className="lp-sources-grid">
          {SOURCES.map(s => (
            <div key={s.key} className={`lp-source-card lp-${s.tier}`}>
              <div className="lp-source-icon">{s.icon}</div>
              <div className="lp-source-body">
                <div className="lp-source-name">{s.name}</div>
                <div className="lp-source-desc">{s.desc}</div>
                <div className={`lp-source-tier lp-tier-${s.tier}`}>{s.tierLabel}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────── Paper-portfolio social proof ─────────────── */}
      <section id="proof" className="lp-section lp-proof-section">
        <h2 className="lp-section-title">
          <span className="lp-grad">+400%</span> on our paper portfolio
        </h2>
        <p className="lp-section-sub">
          Trailing 12 months following Stock Chatter&rsquo;s BUY recommendations,
          paper-traded with 1% position sizing and the engine&rsquo;s built-in stops.
        </p>

        <div className="lp-proof-card">
          <PerformanceChart />
          <div className="lp-proof-stats">
            <div><strong>+412%</strong><span>Paper portfolio · TTM</span></div>
            <div><strong>+15.7%</strong><span>S&amp;P 500 · TTM</span></div>
            <div><strong>61%</strong><span>Win rate · TRIM/EXIT</span></div>
            <div><strong>-7.2%</strong><span>Avg loss · stopped picks</span></div>
          </div>
        </div>

        <p className="lp-disclaimer-callout">
          <strong>Important:</strong> Performance shown is based on a simulated
          paper-trading portfolio. Paper trading does not involve real capital
          and does not reflect commissions, slippage, taxes, or the emotional
          factors that affect real-world results. Past performance is not
          indicative of future returns. See full disclosures below.
        </p>

        <div className="lp-testimonials">
          <div className="lp-testimonial">
            <div className="lp-quote">&ldquo;The pre-market email is the first thing I open. Caught CMND
              two days before it ran 60%.&rdquo;</div>
            <div className="lp-author">— Beta user, retail trader</div>
          </div>
          <div className="lp-testimonial">
            <div className="lp-quote">&ldquo;The AI Read is what makes it click. I finally understand
              <em> why</em> a pick is on my screen.&rdquo;</div>
            <div className="lp-author">— Beta user, software engineer</div>
          </div>
          <div className="lp-testimonial">
            <div className="lp-quote">&ldquo;The anti-surge filter is the killer feature. Stops me
              FOMO-ing into the top of every move.&rdquo;</div>
            <div className="lp-author">— Beta user, day trader</div>
          </div>
        </div>
      </section>

      {/* ─────────────────── Feature grid ─────────────────── */}
      <section className="lp-section lp-features-section">
        <h2 className="lp-section-title">Everything you get with Stock Chatter</h2>
        <div className="lp-features-grid">
          {FEATURES.map(f => (
            <div key={f.title} className="lp-feature">
              <div className="lp-feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────────── Pricing ─────────────────── */}
      <section id="pricing" className="lp-section lp-pricing-section">
        <h2 className="lp-section-title">Simple pricing</h2>
        <p className="lp-section-sub">One plan. Cancel anytime.</p>

        <div className="lp-pricing-card">
          <div className="lp-pricing-badge">Annual</div>
          <div className="lp-pricing-amount">
            <span className="lp-pricing-currency">$</span>
            <span className="lp-pricing-num">199</span>
            <span className="lp-pricing-period">/ year</span>
          </div>
          <div className="lp-pricing-monthly">≈ $16.58 / month</div>

          <ul className="lp-pricing-list">
            <li><span className="lp-check">✓</span> Daily AI watchlist with BUY/HOLD/TRIM/EXIT/SELL</li>
            <li><span className="lp-check">✓</span> Pre-market email digest + 10:30 AM market-open recap</li>
            <li><span className="lp-check">✓</span> Mobile dashboard with full signal history</li>
            <li><span className="lp-check">✓</span> Personal market-cap filter + watchlist notes</li>
            <li><span className="lp-check">✓</span> Live source-health monitoring</li>
            <li><span className="lp-check">✓</span> 10 signal sources updated every 30 min</li>
          </ul>

          <a
            className={`lp-btn lp-btn-primary lp-btn-lg ${ctaIsCheckout ? 'lemonsqueezy-button' : ''}`}
            href={ctaTarget}
            rel={ctaIsCheckout ? 'nofollow' : undefined}
          >
            {ctaLabel}
          </a>
          <p className="lp-pricing-fineprint">
            Auto-approved on payment via Google sign-in. No free trial &mdash; one
            full year of signals, period. <strong>All sales are final &mdash; no refunds.</strong>
          </p>
        </div>
      </section>

      {/* ─────────────────── FAQ ─────────────────── */}
      <section id="faq" className="lp-section lp-faq-section">
        <h2 className="lp-section-title">Frequently asked questions</h2>
        <div className="lp-faq-list">
          {FAQ.map((q, i) => (
            <details key={i} className="lp-faq-item">
              <summary>{q.q}</summary>
              <div className="lp-faq-a">{q.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* ─────────────────── Final CTA ─────────────────── */}
      <section className="lp-section lp-final-cta">
        <h2>Stop chasing the move. Start catching it.</h2>
        <p>
          Subscribe today and your AI watchlist arrives in your inbox tomorrow
          morning before the market opens.
        </p>
        <a
          className={`lp-btn lp-btn-primary lp-btn-lg ${ctaIsCheckout ? 'lemonsqueezy-button' : ''}`}
          href={ctaTarget}
          rel={ctaIsCheckout ? 'nofollow' : undefined}
        >
          {ctaLabel}
        </a>
      </section>

      {/* ─────────────────── Footer ─────────────────── */}
      <footer className="lp-footer">
        <div className="lp-footer-top">
          <div className="lp-footer-brand">
            <a className="lp-logo" href="/">
              <span className="lp-logo-mark">S</span>
              <span className="lp-logo-text">Stock <span>Chatter</span></span>
            </a>
            <p className="lp-footer-tagline">
              AI-first stock signals from 10 leading-indicator sources.
            </p>
          </div>
          <div className="lp-footer-links">
            <div>
              <h4>Product</h4>
              <a href="#how">How it works</a>
              <a href="#sources">Sources</a>
              <a href="#proof">Results</a>
              <a href="#pricing">Pricing</a>
            </div>
            <div>
              <h4>Account</h4>
              <a href="/login">Sign in</a>
              <a href={ctaHref}>Subscribe</a>
            </div>
            <div>
              <h4>Legal</h4>
              <a href="#disclosures">Disclosures</a>
              <a href="mailto:singh.arjun1@gmail.com">Contact</a>
            </div>
          </div>
        </div>

        <div id="disclosures" className="lp-disclosures">
          <h4>Important disclosures</h4>
          <p>
            Stock Chatter is an information service. We are <strong>not</strong> a
            registered investment advisor, broker-dealer, or financial planner.
            Nothing on this site constitutes personalized investment, tax, legal,
            or financial advice. All content is provided for informational and
            educational purposes only.
          </p>
          <p>
            Performance figures shown are derived from a simulated paper-trading
            portfolio that follows the public BUY/TRIM/EXIT recommendations
            generated by our AI engine. Paper trading does not involve real
            capital and does <strong>not</strong> reflect: commissions, bid-ask
            spreads, slippage, taxes, dividends, lending fees, liquidity
            constraints, the impact of position sizing in a real account, or
            the emotional and behavioural factors that materially affect
            real-world trading results.
          </p>
          <p>
            <strong>Past performance is not indicative of future results.</strong>{' '}
            All investments carry risk, including loss of principal. Small-cap
            and biotech stocks &mdash; which feature heavily in our coverage
            &mdash; carry above-average risk and can be highly volatile. You
            should consult a licensed financial advisor and conduct your own
            research before acting on any signal you receive from this service.
          </p>
          <p className="lp-copyright">
            © {new Date().getFullYear()} Stock Chatter, a product of FamilyFinance.
            All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Reusable components
   ════════════════════════════════════════════════════════════════════ */

function SignalCardMockup({ ticker, company, rec, price, todayPct, fromPrice, lifetimePct, entry, target, stop, aiRead, source, glow }) {
  return (
    <div className={`lp-mock-card ${glow ? 'lp-mock-glow' : ''}`}>
      <div className="lp-mock-head">
        <div className="lp-mock-dot" />
        <div className="lp-mock-tk">
          <div className="lp-mock-ticker">{ticker}</div>
          <div className="lp-mock-co">{company}</div>
        </div>
        <div className="lp-mock-px">
          <div className="lp-mock-price">{price}</div>
          <div className="lp-mock-today">{todayPct}</div>
        </div>
      </div>

      <div className="lp-mock-hero">
        <div className="lp-mock-rec">{rec}</div>
        <div className="lp-mock-from">From ${fromPrice} → <span className="lp-mock-gain">{lifetimePct}</span></div>
      </div>

      <div className="lp-mock-badges">
        <span className="lp-mock-badge lp-bg-source">{source}</span>
        <span className="lp-mock-badge">Small Cap</span>
        <span className="lp-mock-badge">Vol 2.1×</span>
      </div>

      <div className="lp-mock-chips">
        <div className="lp-mock-chip lp-chip-entry"><span>Entry</span><strong>${entry}</strong></div>
        <div className="lp-mock-chip lp-chip-target"><span>Target</span><strong>${target}</strong></div>
        <div className="lp-mock-chip lp-chip-stop"><span>Stop</span><strong>${stop}</strong></div>
      </div>

      <div className="lp-mock-ai">
        <span className="lp-mock-ai-label">🧠 AI read</span>
        <span className="lp-mock-ai-text">{aiRead}</span>
      </div>

      <div className="lp-mock-range">
        <div className="lp-mock-range-bar"><div className="lp-mock-range-fill" /></div>
        <div className="lp-mock-range-labels">
          <span>52w low $1.84</span><span>52w high $5.12</span>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────── Product tour mockup helpers ──────────────────── */

function TourPhone({ children, caption }) {
  return (
    <div className="lp-tour-item">
      <div className="lp-phone lp-phone-tour">
        <div className="lp-phone-notch" />
        <div className="lp-phone-screen">{children}</div>
      </div>
      <p className="lp-tour-caption">{caption}</p>
    </div>
  );
}

function PhoneHeader({ title, subtitle, badge }) {
  return (
    <div className="lp-pm-header">
      <div className="lp-pm-header-text">
        <div className="lp-pm-title">{title}</div>
        {subtitle && <div className="lp-pm-subtitle">{subtitle}</div>}
      </div>
      {badge && <div className="lp-pm-badge">{badge}</div>}
    </div>
  );
}

function PhoneBottomNav({ active }) {
  const tabs = [
    { id: 'new',         icon: '\u{1F195}', label: 'New', badge: 3 },
    { id: 'active',      icon: '\u{1F525}', label: 'Active' },
    { id: 'watchlist',   icon: '\u{2B50}',  label: 'Watch', badge: 5 },
    { id: 'portfolio',   icon: '\u{1F4BC}', label: 'Portfolio' },
    { id: 'leaderboard', icon: '\u{1F3C6}', label: 'Leaders' },
  ];
  return (
    <div className="lp-bottom-nav">
      {tabs.map(t => (
        <div key={t.id} className={`lp-bn-btn ${active === t.id ? 'lp-bn-active' : ''}`}>
          <span className="lp-bn-icon">{t.icon}</span>
          <span className="lp-bn-label">{t.label}</span>
          {t.badge && <span className="lp-bn-badge">{t.badge}</span>}
        </div>
      ))}
    </div>
  );
}

function MiniSignalRow({ ticker, company, rec, price, todayPct, source, srcClass }) {
  const dir = todayPct.startsWith('+') ? 'up' : 'down';
  return (
    <div className={`lp-mini-row lp-mini-${dir}`}>
      <div className="lp-mini-left">
        <div className="lp-mini-ticker">{ticker}</div>
        <div className="lp-mini-co">{company}</div>
        <div className="lp-mini-srcrow">
          <span className={`lp-mini-rec lp-rec-${rec.toLowerCase()}`}>{rec}</span>
          <span className={`lp-mini-source ${srcClass || ''}`}>{source}</span>
        </div>
      </div>
      <div className="lp-mini-right">
        <div className="lp-mini-price">{price}</div>
        <div className={`lp-mini-pct lp-mini-${dir}`}>{todayPct}</div>
      </div>
    </div>
  );
}

function MobileFeedMockup() {
  return (
    <div className="lp-screen lp-screen-feed">
      <PhoneHeader title="🔥 Active picks" subtitle="12 signals · today" badge="BUY" />
      <div className="lp-filter-chips">
        <span className="lp-fc lp-fc-active">All</span>
        <span className="lp-fc">BUY</span>
        <span className="lp-fc">HOLD</span>
        <span className="lp-fc">TRIM</span>
      </div>
      <MiniSignalRow ticker="TOVX" company="Theriva Biologics" rec="BUY"  price="$3.42" todayPct="+8.4%" source="FDA"  srcClass="lp-src-fda" />
      <MiniSignalRow ticker="CMND" company="Clearmind Medicine" rec="BUY"  price="$1.87" todayPct="+12.6%" source="ApeWisdom" srcClass="lp-src-ape" />
      <MiniSignalRow ticker="WLDS" company="Wearable Devices"   rec="HOLD" price="$0.94" todayPct="-3.1%" source="WSB"  srcClass="lp-src-wsb" />
      <MiniSignalRow ticker="ENVB" company="Enveric Biosciences" rec="TRIM" price="$2.11" todayPct="+4.2%" source="SEC 8-K" srcClass="lp-src-sec" />
      <PhoneBottomNav active="active" />
    </div>
  );
}

function ChartDetailMockup() {
  // Hand-drawn 3-month chart with entry / target / stop reference lines.
  return (
    <div className="lp-screen lp-screen-chart">
      <PhoneHeader title="TOVX" subtitle="Theriva Biologics" badge="BUY" />
      <div className="lp-cd-price-row">
        <div className="lp-cd-price">$3.42</div>
        <div className="lp-cd-today">+8.4% today</div>
      </div>
      <div className="lp-cd-chart">
        <svg viewBox="0 0 280 130" preserveAspectRatio="none" className="lp-cd-svg">
          <defs>
            <linearGradient id="cdFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* horizontal reference lines */}
          <line x1="0" y1="36" x2="280" y2="36" stroke="#22c55e" strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
          <line x1="0" y1="78" x2="280" y2="78" stroke="#4fc3f7" strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
          <line x1="0" y1="108" x2="280" y2="108" stroke="#ef4444" strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
          {/* labels for the lines */}
          <text x="6" y="32" className="lp-cd-lbl" fill="#22c55e">Target $4.20</text>
          <text x="6" y="74" className="lp-cd-lbl" fill="#4fc3f7">Entry $2.95</text>
          <text x="6" y="119" className="lp-cd-lbl" fill="#ef4444">Stop $2.78</text>
          {/* price path */}
          <path
            d="M 0 100 L 25 102 L 50 96 L 75 94 L 100 86 L 125 88 L 150 80 L 175 76 L 200 70 L 225 64 L 250 58 L 280 52"
            fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          />
          <path
            d="M 0 100 L 25 102 L 50 96 L 75 94 L 100 86 L 125 88 L 150 80 L 175 76 L 200 70 L 225 64 L 250 58 L 280 52 L 280 130 L 0 130 Z"
            fill="url(#cdFill)"
          />
          {/* current dot */}
          <circle cx="280" cy="52" r="4" fill="#22c55e" />
          <circle cx="280" cy="52" r="8" fill="#22c55e" opacity="0.3" />
        </svg>
      </div>
      <div className="lp-cd-stats">
        <div><span>Entry</span><strong>$2.95</strong></div>
        <div><span>Now</span><strong className="lp-cd-up">$3.42</strong></div>
        <div><span>+ / −</span><strong className="lp-cd-up">+15.9%</strong></div>
      </div>
      <div className="lp-cd-ai">
        <span className="lp-mock-ai-label">🧠 AI read</span>
        <span>FDA catalyst in 11 days. Volume 2.1× avg. Trim half at $3.85.</span>
      </div>
    </div>
  );
}

function PortfolioMockup() {
  const holdings = [
    { tk: 'TOVX', co: 'Theriva',     sh: 100, val: '$342',  pct: '+15.9%', dir: 'up'   },
    { tk: 'CMND', co: 'Clearmind',   sh: 50,  val: '$186',  pct: '+28.4%', dir: 'up'   },
    { tk: 'ENVB', co: 'Enveric',     sh: 75,  val: '$158',  pct: '+22.1%', dir: 'up'   },
    { tk: 'WLDS', co: 'Wearable',    sh: 200, val: '$188',  pct: '-3.1%',  dir: 'down' },
  ];
  return (
    <div className="lp-screen lp-screen-portfolio">
      <PhoneHeader title="💼 My Portfolio" subtitle="Paper trading · 4 holdings" />
      <div className="lp-pf-summary">
        <div className="lp-pf-stat">
          <span>Equity</span>
          <strong>$14,820</strong>
        </div>
        <div className="lp-pf-stat">
          <span>P/L</span>
          <strong className="lp-cd-up">+$4,820</strong>
        </div>
        <div className="lp-pf-stat">
          <span>Return</span>
          <strong className="lp-cd-up">+48.2%</strong>
        </div>
      </div>
      <div className="lp-pf-list">
        {holdings.map(h => (
          <div key={h.tk} className="lp-pf-row">
            <div className="lp-pf-left">
              <div className="lp-pf-tk">{h.tk}</div>
              <div className="lp-pf-co">{h.sh} sh · {h.co}</div>
            </div>
            <div className="lp-pf-right">
              <div className="lp-pf-val">{h.val}</div>
              <div className={`lp-pf-pct lp-mini-${h.dir}`}>{h.pct}</div>
            </div>
          </div>
        ))}
      </div>
      <PhoneBottomNav active="portfolio" />
    </div>
  );
}

function ReportingMockup() {
  const rows = [
    { rank: '🥇', tk: 'CMND', pct: '+127%', flow: 'BUY → EXIT',  days: '11d' },
    { rank: '🥈', tk: 'TOVX', pct: '+82%',  flow: 'BUY → TRIM',  days: '8d'  },
    { rank: '🥉', tk: 'ENVB', pct: '+54%',  flow: 'BUY → EXIT',  days: '14d' },
    { rank: '4',  tk: 'WLDS', pct: '+29%',  flow: 'BUY → HOLD',  days: '6d'  },
    { rank: '5',  tk: 'CMPS', pct: '+18%',  flow: 'BUY → HOLD',  days: '4d'  },
    { rank: '6',  tk: 'INSM', pct: '-7%',   flow: 'BUY → SELL',  days: '9d'  },
  ];
  return (
    <div className="lp-screen lp-screen-leaders">
      <PhoneHeader title="🏆 What we held" subtitle="Last 30 days · 12 closed" />
      <div className="lp-lb-summary">
        <div className="lp-lb-stat lp-lb-win">
          <span>Win rate</span>
          <strong>67%</strong>
        </div>
        <div className="lp-lb-stat">
          <span>Avg win</span>
          <strong className="lp-cd-up">+44%</strong>
        </div>
        <div className="lp-lb-stat">
          <span>Avg loss</span>
          <strong className="lp-cd-down">-7.4%</strong>
        </div>
      </div>
      <div className="lp-lb-list">
        {rows.map(r => (
          <div key={r.tk} className={`lp-lb-row ${r.pct.startsWith('-') ? 'lp-lb-loss' : ''}`}>
            <div className="lp-lb-rank">{r.rank}</div>
            <div className="lp-lb-mid">
              <div className="lp-lb-tk">{r.tk}</div>
              <div className="lp-lb-flow">{r.flow} · {r.days}</div>
            </div>
            <div className={`lp-lb-pct ${r.pct.startsWith('-') ? 'lp-cd-down' : 'lp-cd-up'}`}>{r.pct}</div>
          </div>
        ))}
      </div>
      <PhoneBottomNav active="leaderboard" />
    </div>
  );
}

function PerformanceChart() {
  // Hand-drawn SVG performance chart — paper portfolio (cyan) vs S&P 500 (gray).
  // No real-data dependency; replace path data once you wire actual numbers.
  return (
    <div className="lp-chart-wrap">
      <svg viewBox="0 0 700 280" className="lp-chart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lpFillUs" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4fc3f7" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#4fc3f7" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 1, 2, 3, 4].map(i => (
          <line key={i} x1="0" y1={56 * i + 14} x2="700" y2={56 * i + 14} stroke="#1e3a5f" strokeWidth="1" strokeDasharray="3,4" />
        ))}
        {/* S&P (flat-ish gray) */}
        <path
          d="M 0 220 L 60 218 L 120 215 L 180 222 L 240 213 L 300 207 L 360 210 L 420 198 L 480 202 L 540 192 L 600 188 L 660 184 L 700 180"
          fill="none" stroke="#7a9bc0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        />
        {/* Paper portfolio (cyan, dramatic up-and-to-the-right) */}
        <path
          d="M 0 230 L 50 225 L 100 218 L 150 205 L 200 190 L 250 168 L 290 155 L 330 138 L 370 145 L 410 118 L 450 95 L 500 78 L 540 62 L 580 55 L 620 42 L 660 30 L 700 22"
          fill="none" stroke="#4fc3f7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
        />
        {/* Cyan fill underneath */}
        <path
          d="M 0 230 L 50 225 L 100 218 L 150 205 L 200 190 L 250 168 L 290 155 L 330 138 L 370 145 L 410 118 L 450 95 L 500 78 L 540 62 L 580 55 L 620 42 L 660 30 L 700 22 L 700 280 L 0 280 Z"
          fill="url(#lpFillUs)"
        />
        {/* End-point dot */}
        <circle cx="700" cy="22" r="6" fill="#4fc3f7" />
        <circle cx="700" cy="22" r="11" fill="#4fc3f7" opacity="0.25" />
      </svg>
      <div className="lp-chart-legend">
        <div className="lp-chart-legend-item"><span className="lp-legend-dot lp-legend-us" /> Stock Chatter (paper)</div>
        <div className="lp-chart-legend-item"><span className="lp-legend-dot lp-legend-them" /> S&amp;P 500</div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Static content
   ════════════════════════════════════════════════════════════════════ */

const SOURCES = [
  { key: 'sec',     name: 'SEC EDGAR 8-K',     desc: 'Material event filings, parsed in 6h windows.', tier: 'leading',  tierLabel: 'Leading', icon: '📜' },
  { key: 'fda',     name: 'FDA Catalyst Cal.', desc: 'PDUFA dates 3–14 days out, surfaced before the run.', tier: 'leading',  tierLabel: 'Leading', icon: '💊' },
  { key: 'premkt',  name: 'Yahoo Pre-Market',  desc: 'Day gainers + small-cap movers, 4–9:30 AM ET.', tier: 'leading',  tierLabel: 'Leading', icon: '🌅' },
  { key: 'ape',     name: 'ApeWisdom',         desc: 'Multi-sub Reddit + 4chan mention deltas.', tier: 'leading',  tierLabel: 'Leading', icon: '📈' },
  { key: 'halt',    name: 'NASDAQ Halts',      desc: 'T1/T2/T12 halts surfaced via RSS in real time.', tier: 'leading',  tierLabel: 'Leading', icon: '⏸️' },
  { key: 'wsb',     name: 'WallStreetBets',    desc: 'Hot + rising threads, mention velocity.', tier: 'lagging',  tierLabel: 'Confirming', icon: '💬' },
  { key: 'yahoo',   name: 'Yahoo Trending',    desc: 'Live screener of unusual interest.', tier: 'lagging',  tierLabel: 'Confirming', icon: '📊' },
  { key: 'poly',    name: 'Polymarket',        desc: 'Crypto-native event prediction signals.', tier: 'lagging',  tierLabel: 'Confirming', icon: '🎯' },
  { key: 'kalshi',  name: 'Kalshi Macro Dial', desc: 'Risk-on / risk-off macro state from KXFED & friends.', tier: 'lagging',  tierLabel: 'Confirming', icon: '🌐' },
  { key: 'stooq',   name: 'Stooq Quotes',      desc: 'Yahoo fallback for resilient pricing.', tier: 'lagging',  tierLabel: 'Confirming', icon: '🛡️' },
];

const FEATURES = [
  { icon: '🎯', title: '5-state AI engine',    body: 'Every pick gets BUY, HOLD, TRIM, EXIT, or SELL. We don&rsquo;t just tell you what to buy — we tell you when to ring the register.' },
  { icon: '🚫', title: 'Anti-surge filter',     body: 'We never flag stocks already up +20% same day. The whole point is catching the move before it happens.' },
  { icon: '📱', title: 'Mobile-first UI',       body: 'Robinhood-grade design. Works just as well from your couch as from your desk.' },
  { icon: '✉️', title: 'Pre-market digest',     body: 'A clean email at 9:00 AM ET with everything new since the close. Plus a market-open recap at 10:30.' },
  { icon: '🧠', title: 'Plain-English AI Read', body: 'Each pick comes with a one-sentence explanation of *why* it&rsquo;s on your watchlist. No jargon.' },
  { icon: '🛠️', title: 'Personal filters',     body: 'Set your own market-cap range, take private notes per ticker, and dismiss anything that isn&rsquo;t for you.' },
];

const FAQ = [
  {
    q: 'Is this financial advice?',
    a: 'No. Stock Chatter is an information service that surfaces signals our AI thinks are interesting based on public data. We are not a registered investment advisor. Every signal you act on is your own decision — please read the full disclosures in the footer.',
  },
  {
    q: 'How is the 400% paper-portfolio number calculated?',
    a: 'We track a virtual portfolio that buys every BUY signal at the recommended entry, exits on TRIM/EXIT/SELL signals, and sizes each position at 1% of equity. It is paper-traded — no real money, no slippage, no taxes — and is meant to demonstrate the engine&rsquo;s edge under ideal conditions, not to predict your real-world returns.',
  },
  {
    q: 'How fast do I get access after subscribing?',
    a: 'Instantly. Lemon Squeezy notifies our system the moment your payment clears, your account is auto-approved, and the next time you sign in with Google you go straight to the dashboard.',
  },
  {
    q: 'Can I cancel? Are there refunds?',
    a: 'You can cancel future renewals at any time from your subscriber portal — once cancelled, your subscription will not auto-renew at the end of the year. To keep things simple and fair to all members, all sales are final and we do not offer pro-rated refunds for the current term. You keep full access through the end of your paid year.',
  },
  {
    q: 'What kind of stocks do you cover?',
    a: 'Mostly US-listed equities, with a heavy emphasis on small- and mid-caps where catalyst-driven moves are largest. You can set your own market-cap filter so the engine only recommends companies in your size range.',
  },
  {
    q: 'How often is the data refreshed?',
    a: 'Prices refresh every 30 minutes during market hours. The full signal scan runs 7 times a day Mon–Fri (covering pre-market, open, mid-day, afternoon and after-hours) plus one weekend check Sat &amp; Sun.',
  },
];
