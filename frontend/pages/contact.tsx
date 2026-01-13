import Head from 'next/head';
import { useState } from 'react';
import { MarketingNav } from '../components/MarketingNav';
import { Button, Card, Container, Section } from '../components/MarketingUI';
import { apiRequest } from '../lib/api';

const PRODUCT_NAME = 'RagReady';

const storageOptions = ['SharePoint', 'Confluence', 'Teams or OneDrive', 'Local files', 'S3', 'Other'];

export default function ContactPage() {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [segment, setSegment] = useState('');
  const [goal, setGoal] = useState('');
  const [volume, setVolume] = useState('');
  const [storage, setStorage] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const toggleStorage = (option: string) => {
    setStorage((current) =>
      current.includes(option) ? current.filter((item) => item !== option) : [...current, option]
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!name.trim() || !company.trim() || !email.trim() || !segment || !goal.trim() || !volume) {
      setError('Please complete all required fields.');
      return;
    }

    if (storage.length === 0) {
      setError('Please select at least one document location.');
      return;
    }

    setStatus('sending');
    try {
      await apiRequest('/public/contact', {
        method: 'POST',
        body: {
          name: name.trim(),
          company: company.trim(),
          email: email.trim(),
          phone: phone.trim(),
          segment,
          goal: goal.trim(),
          volume,
          storage
        }
      });
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError('Something went wrong. Please try again.');
    }
  };

  return (
    <>
      <Head>
        <title>Contact us | {PRODUCT_NAME}</title>
      </Head>
      <MarketingNav />
      <main className="landing-main">
        <Section className="section-soft">
          <Container>
            <div className="section-header">
              <h1>Contact us</h1>
              <p>Tell us about your data sources and what you want your AI assistant to answer.</p>
            </div>
            <div className="contact-grid">
              <Card className="contact-card">
                {status === 'success' ? (
                  <div className="contact-success">
                    <h2>Thank you</h2>
                    <p>We have received your details and will be in touch shortly.</p>
                    <div className="cta-actions">
                      <Button href="/">Back to home</Button>
                      <Button href="/login" variant="secondary">
                        Log in
                      </Button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="contact-form">
                    <div className="form-row">
                      <label>
                        Name
                        <input
                          className="input"
                          type="text"
                          autoComplete="name"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        Company
                        <input
                          className="input"
                          type="text"
                          autoComplete="organization"
                          value={company}
                          onChange={(event) => setCompany(event.target.value)}
                          required
                        />
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        Email
                        <input
                          className="input"
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        Phone (optional)
                        <input
                          className="input"
                          type="tel"
                          autoComplete="tel"
                          value={phone}
                          onChange={(event) => setPhone(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        Primary industry segment
                        <select
                          className="input"
                          value={segment}
                          onChange={(event) => setSegment(event.target.value)}
                          required
                        >
                          <option value="">Select a segment</option>
                          <option value="Commercial construction">Commercial construction</option>
                          <option value="Civil">Civil</option>
                          <option value="Residential">Residential</option>
                          <option value="Maintenance">Maintenance</option>
                          <option value="Other">Other</option>
                        </select>
                      </label>
                      <label>
                        Approx document volume
                        <select
                          className="input"
                          value={volume}
                          onChange={(event) => setVolume(event.target.value)}
                          required
                        >
                          <option value="">Select volume</option>
                          <option value="Under 5k">Under 5k documents</option>
                          <option value="5k to 20k">5k to 20k documents</option>
                          <option value="20k to 100k">20k to 100k documents</option>
                          <option value="100k plus">100k plus documents</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      What are you trying to achieve?
                      <textarea
                        className="input"
                        value={goal}
                        onChange={(event) => setGoal(event.target.value)}
                        rows={4}
                        required
                      />
                    </label>
                    <fieldset className="contact-fieldset">
                      <legend>Where are your documents stored?</legend>
                      <div className="checkbox-grid">
                        {storageOptions.map((option) => (
                          <label key={option} className="checkbox-item">
                            <input
                              type="checkbox"
                              checked={storage.includes(option)}
                              onChange={() => toggleStorage(option)}
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {error && <p className="form-error">{error}</p>}
                    <Button type="submit" disabled={status === 'sending'}>
                      {status === 'sending' ? 'Sending...' : 'Send message'}
                    </Button>
                  </form>
                )}
              </Card>
              <div className="contact-info">
                <Card>
                  <h3>Prefer email or phone?</h3>
                  <p>Email: hello@example.com</p>
                  <p>Phone: +61 2 0000 0000</p>
                  <p>Address: Level 10, 123 Collins Street, Melbourne VIC</p>
                </Card>
                <Card>
                  <h3>What happens next</h3>
                  <ul className="check-list">
                    <li>We review your sources and requirements</li>
                    <li>We outline the best connector plan</li>
                    <li>We share a tailored rollout timeline</li>
                  </ul>
                </Card>
              </div>
            </div>
          </Container>
        </Section>
      </main>
    </>
  );
}
