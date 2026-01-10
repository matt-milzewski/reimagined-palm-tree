import Head from 'next/head';
import Link from 'next/link';
import { MarketingNav } from '../components/MarketingNav';
import { Accordion, Button, Card, Container, Section, Tabs } from '../components/MarketingUI';

const PRODUCT_NAME = 'RAG Readiness Pipeline';

const painPoints = [
  {
    title: 'Revisions across projects',
    description:
      'Superseded documents live beside approved ones, which creates conflicting answers on site.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M7 3h7l4 4v14H7z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M14 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    )
  },
  {
    title: 'Tables and registers in PDFs',
    description:
      'Critical data hides in registers, schedules and forms that lose structure when copied.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="4" y="5" width="16" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 10h16M10 5v14" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    )
  },
  {
    title: 'Duplicates in shared libraries',
    description:
      'Template reuse spreads copies across SharePoint sites and drives inconsistent guidance.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="6" y="6" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 10V4h10" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    )
  },
  {
    title: 'Time lost searching for answers',
    description:
      'Teams waste hours verifying the latest safety and quality information before work starts.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 8v4l3 2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    )
  }
];

const connectors = [
  {
    name: 'SharePoint',
    description: 'Sync sites and libraries on a schedule.',
    status: 'Available'
  },
  {
    name: 'Microsoft 365 file libraries',
    description: 'Keep project folders current across teams.',
    status: 'Available'
  },
  {
    name: 'Confluence',
    description: 'Index spaces and pages with hierarchy.',
    status: 'Available'
  },
  {
    name: 'File uploads',
    description: 'PDF, DOCX, CSV and JSON supported.',
    status: 'Available'
  },
  {
    name: 'S3 or file storage',
    description: 'Import from structured exports.',
    status: 'Available'
  }
];

const faqItems = [
  {
    title: 'Do you replace SharePoint or Confluence?',
    content:
      'No. We connect to your existing systems and prepare knowledge for AI and RAG without changing your source of truth.'
  },
  {
    title: 'Do we need to change how we store documents?',
    content:
      'You can keep current structures. We map your folders, spaces and registers so the AI layer is aligned with your current taxonomy.'
  },
  {
    title: 'What sources and file types do you support?',
    content:
      'We support SharePoint, Confluence, Microsoft 365 file libraries, and file uploads for PDF, DOCX, CSV and JSON. Additional sources are available by plan.'
  },
  {
    title: 'How do you handle revisions and superseded files?',
    content:
      'We track document lineage, metadata and file history so the latest approved content is prioritised while older versions remain traceable.'
  },
  {
    title: 'Can we control what users can access?',
    content:
      'Yes. We preserve source metadata and can pass permissions and project boundaries into your chatbot and retrieval layer.'
  },
  {
    title: 'Do you integrate with Teams or chat tools?',
    content:
      'We provide exports and APIs that plug into your preferred chat experience. Direct Teams delivery can be configured on request.'
  },
  {
    title: 'Can we export the processed knowledge?',
    content:
      'Yes. You receive JSONL knowledge packs plus a manifest, or you can stream via API into your RAG storage.'
  },
  {
    title: 'How long does onboarding take?',
    content:
      'Most teams connect sources and see first results within two weeks, depending on access approvals and data volume.'
  }
];

export default function LandingPage() {
  return (
    <>
      <Head>
        <title>{PRODUCT_NAME}</title>
      </Head>
      <MarketingNav />
      <main className="landing-main">
        <section className="hero">
          <Container className="hero-grid">
            <div className="hero-copy reveal">
              <p className="eyebrow">Construction data readiness platform</p>
              <h1>Construction knowledge, ready for AI every day.</h1>
              <p className="hero-subtitle">
                {PRODUCT_NAME} connects to SharePoint, Confluence and your project file libraries, and also
                supports uploads like PDF, DOCX, CSV and JSON. It cleans, structures, deduplicates and tracks
                revisions so your chatbot and RAG stack can answer with citations.
              </p>
              <div className="hero-actions">
                <Button href="/contact">Contact us for pricing</Button>
                <Button href="/login" variant="secondary">
                  Log in
                </Button>
              </div>
              <div className="trusted-row">
                <span className="trusted-label">Trusted by</span>
                <div className="logo-row">
                  {['Harbour Build', 'Axis Civil', 'Northbank', 'Coastal Works', 'Steelbridge'].map((logo) => (
                    <span key={logo} className="logo-pill">
                      {logo}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="hero-panel">
              <div className="hero-panel-inner">
                <div className="hero-metric">
                  <span>Readiness score</span>
                  <strong>92</strong>
                </div>
                <div className="hero-metric">
                  <span>Duplicates removed</span>
                  <strong>38%</strong>
                </div>
                <div className="hero-metric">
                  <span>Latest revisions</span>
                  <strong>Verified</strong>
                </div>
                <div className="hero-diagram">
                  <div className="diagram-card">Sources</div>
                  <div className="diagram-arrow" aria-hidden>
                    &gt;
                  </div>
                  <div className="diagram-card">Refinement</div>
                  <div className="diagram-arrow" aria-hidden>
                    &gt;
                  </div>
                  <div className="diagram-card">Knowledge pack</div>
                </div>
              </div>
            </div>
          </Container>
        </section>

        <Section className="section-soft">
          <Container>
            <div className="section-header">
              <h2>Why construction knowledge is hard to use</h2>
            </div>
            <div className="grid four">
              {painPoints.map((point, index) => (
                <Card key={point.title} className="icon-card reveal" style={{ animationDelay: `${index * 0.08}s` }}>
                  <div className={`icon-badge tone-${index + 1}`}>
                    {point.icon}
                  </div>
                  <h3>{point.title}</h3>
                  <p>{point.description}</p>
                </Card>
              ))}
            </div>
          </Container>
        </Section>

        <Section id="product">
          <Container>
            <div className="section-header">
              <h2>A readiness layer built for construction data</h2>
              <p>
                Give your AI assistants a structured, clean and verified knowledge layer. We normalise registers,
                track revisions, and keep your most current guidance front and centre.
              </p>
            </div>
            <div className="solution-grid">
              <div className="solution-list">
                <ul className="check-list">
                  <li>Connect all your sources, not just one platform</li>
                  <li>Daily change detection and incremental processing</li>
                  <li>Clean, structured chunks with citations and source pointers</li>
                  <li>Revision-aware retrieval that prefers latest approved content</li>
                  <li>Dedupe and quality scoring to reduce noise and boost accuracy</li>
                  <li>Works with your existing RAG storage and AI tools</li>
                </ul>
              </div>
              <Card className="diagram-stack">
                <h3>End to end flow</h3>
                <div className="diagram-flow">
                  <div className="diagram-node">Sources<br />SharePoint, Confluence, CSV, PDFs</div>
                  <div className="diagram-line" aria-hidden />
                  <div className="diagram-node">Ingestion</div>
                  <div className="diagram-line" aria-hidden />
                  <div className="diagram-node">Refinement</div>
                  <div className="diagram-line" aria-hidden />
                  <div className="diagram-node">Knowledge pack</div>
                  <div className="diagram-line" aria-hidden />
                  <div className="diagram-node">RAG and chatbot</div>
                </div>
              </Card>
            </div>
          </Container>
        </Section>

        <Section id="sources" className="section-soft">
          <Container>
            <div className="section-header">
              <h2>Connect the tools you already use</h2>
            </div>
            <div className="grid three">
              {connectors.map((connector) => (
                <Card key={connector.name} className="connector-card">
                  <div className="connector-header">
                    <h3>{connector.name}</h3>
                    <span className="status-pill">{connector.status}</span>
                  </div>
                  <p>{connector.description}</p>
                </Card>
              ))}
            </div>
            <p className="disclaimer">Available connectors depend on your plan and deployment.</p>
          </Container>
        </Section>

        <Section id="how">
          <Container>
            <div className="section-header">
              <h2>How it works</h2>
            </div>
            <div className="timeline">
              {[
                {
                  title: 'Connect sources or upload project documents',
                  description: 'Link your live libraries or upload critical project packs.'
                },
                {
                  title: 'Extract text, tables and structure',
                  description: 'Parse layouts, registers and key fields with construction context.'
                },
                {
                  title: 'Refine for retrieval quality',
                  description: 'Clean formatting, rebuild sections and create consistent chunks.'
                },
                {
                  title: 'Apply construction intelligence',
                  description: 'Detect revisions, duplicates and metadata for better answers.'
                },
                {
                  title: 'Deliver a citation-ready knowledge pack',
                  description: 'Export JSONL and manifest files or push via API.'
                }
              ].map((step, index) => (
                <div key={step.title} className="timeline-step">
                  <div className="step-index">0{index + 1}</div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              ))}
            </div>
          </Container>
        </Section>

        <Section id="use-cases" className="section-soft">
          <Container>
            <div className="section-header">
              <h2>Construction use cases</h2>
            </div>
            <Tabs
              tabs={[
                {
                  id: 'safety',
                  label: 'Safety and compliance',
                  content: (
                    <div className="use-case">
                      <div>
                        <h3>Safety teams get instant answers</h3>
                        <p>Keep site safety and compliance aligned with current SWMS, SOP and toolbox talk guidance.</p>
                      </div>
                      <div className="chat-bubbles">
                        <div className="bubble">What is the latest confined space procedure? <span>[Source: Project Docs]</span></div>
                        <div className="bubble">Show the excavation permit checklist. <span>[Source: Safety Register]</span></div>
                        <div className="bubble">Which site induction applies to this precinct? <span>[Source: Inductions]</span></div>
                      </div>
                    </div>
                  )
                },
                {
                  id: 'quality',
                  label: 'Quality and delivery',
                  content: (
                    <div className="use-case">
                      <div>
                        <h3>Quality teams stay on the latest standard</h3>
                        <p>Keep ITPs, RFIs and site instructions searchable and aligned with revisions.</p>
                      </div>
                      <div className="chat-bubbles">
                        <div className="bubble">Which concrete pour checklist is current? <span>[Source: ITP Library]</span></div>
                        <div className="bubble">Summarise open RFIs for this stage. <span>[Source: RFI Register]</span></div>
                        <div className="bubble">What inspection records are missing? <span>[Source: QA Logs]</span></div>
                      </div>
                    </div>
                  )
                },
                {
                  id: 'handover',
                  label: 'Handover and O and M',
                  content: (
                    <div className="use-case">
                      <div>
                        <h3>Handover teams get faster close out</h3>
                        <p>Prepare manuals, warranties and maintenance schedules for easy retrieval.</p>
                      </div>
                      <div className="chat-bubbles">
                        <div className="bubble">Find the latest HVAC warranty terms. <span>[Source: O and M Manuals]</span></div>
                        <div className="bubble">Where is the fire system test record? <span>[Source: Commissioning]</span></div>
                        <div className="bubble">List the maintenance schedule for lifts. <span>[Source: Asset Register]</span></div>
                      </div>
                    </div>
                  )
                }
              ]}
            />
          </Container>
        </Section>

        <Section>
          <Container>
            <div className="section-header">
              <h2>Key capabilities</h2>
            </div>
            <div className="grid four">
              {[
                'Multi-source connectors for SharePoint, Confluence and files',
                'PDF and DOC parsing with table handling',
                'Structured data ingestion for CSV and JSON',
                'Revision tracking and superseded logic',
                'Permissions-aware metadata for safe access',
                'RAG readiness scoring and reporting',
                'Export formats including JSONL and manifest files',
                'Audit trail and provenance tracking'
              ].map((capability) => (
                <Card key={capability} className="capability-card">
                  <p>{capability}</p>
                </Card>
              ))}
            </div>
          </Container>
        </Section>

        <Section id="security" className="section-soft">
          <Container>
            <div className="section-header">
              <h2>Security and privacy</h2>
              <p>
                Your construction knowledge remains protected with tenant isolation, encryption in transit and at
                rest, and least privilege access to connectors.
              </p>
            </div>
            <div className="grid three">
              {[
                'Tenant isolation with dedicated data partitions',
                'Encryption in transit and at rest for all artefacts',
                'Export options including customer controlled storage',
                'Data retention controls and lifecycle policies'
              ].map((item) => (
                <Card key={item} className="security-card">
                  <p>{item}</p>
                </Card>
              ))}
            </div>
            <p className="disclaimer">Security features vary by deployment. Contact us for details.</p>
          </Container>
        </Section>

        <Section id="faq">
          <Container>
            <div className="section-header">
              <h2>Frequently asked questions</h2>
            </div>
            <Accordion items={faqItems} />
          </Container>
        </Section>

        <Section className="section-cta">
          <Container className="cta-panel">
            <div>
              <h2>Make your project knowledge instantly usable.</h2>
              <p>Built for construction teams. Works with your existing AI stack.</p>
            </div>
            <div className="cta-actions">
              <Button href="/contact">Contact us</Button>
              <Button href="/login" variant="secondary">
                Log in
              </Button>
            </div>
          </Container>
        </Section>

        <footer className="footer">
          <Container className="footer-grid">
            <div>
              <div className="logo">{PRODUCT_NAME}</div>
              <p>Construction data readiness for reliable AI assistants.</p>
              <p>ABN: 00 000 000 000</p>
              <p>Level 10, 123 Collins Street, Melbourne VIC</p>
              <p>Email: hello@example.com</p>
            </div>
            <div>
              <h4>Product</h4>
              <Link href="/#product">Overview</Link>
              <Link href="/#sources">Sources</Link>
              <Link href="/#how">How it works</Link>
            </div>
            <div>
              <h4>Company</h4>
              <Link href="/contact">Contact</Link>
              <Link href="/login">Log in</Link>
              <Link href="/#faq">FAQ</Link>
            </div>
            <div>
              <h4>Legal</h4>
              <Link href="/privacy">Privacy policy</Link>
              <Link href="/terms">Terms</Link>
              <span className="muted">Security features vary by deployment.</span>
            </div>
          </Container>
        </footer>
      </main>
    </>
  );
}
