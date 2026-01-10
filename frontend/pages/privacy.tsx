import Head from 'next/head';
import { MarketingNav } from '../components/MarketingNav';
import { Container, Section } from '../components/MarketingUI';

export default function PrivacyPage() {
  return (
    <>
      <Head>
        <title>Privacy policy</title>
      </Head>
      <MarketingNav />
      <main className="landing-main">
        <Section>
          <Container>
            <div className="section-header">
              <h1>Privacy policy</h1>
              <p>This page is a placeholder for the privacy policy.</p>
            </div>
            <p>
              We treat customer data with care and apply security controls appropriate to your deployment. Contact us
              if you need a full privacy pack for your organisation.
            </p>
          </Container>
        </Section>
      </main>
    </>
  );
}
