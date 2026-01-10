import Head from 'next/head';
import { MarketingNav } from '../components/MarketingNav';
import { Container, Section } from '../components/MarketingUI';

export default function TermsPage() {
  return (
    <>
      <Head>
        <title>Terms of service</title>
      </Head>
      <MarketingNav />
      <main className="landing-main">
        <Section>
          <Container>
            <div className="section-header">
              <h1>Terms of service</h1>
              <p>This page is a placeholder for terms and conditions.</p>
            </div>
            <p>
              Full terms will be provided with your commercial agreement. Contact us if you need a copy for review.
            </p>
          </Container>
        </Section>
      </main>
    </>
  );
}
