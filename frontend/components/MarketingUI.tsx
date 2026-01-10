import Link from 'next/link';
import { useState, type ReactNode, type HTMLAttributes } from 'react';

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

type ButtonProps = {
  href?: string;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

export function Button({
  href,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
  className,
  children
}: ButtonProps) {
  const classes = cx('btn', variant !== 'primary' && variant, className);
  if (href) {
    return (
      <Link className={classes} href={href}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

type ContainerProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Container({ className, children, ...rest }: ContainerProps) {
  return (
    <div className={cx('container', className)} {...rest}>
      {children}
    </div>
  );
}

type SectionProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function Section({ className, children, ...rest }: SectionProps) {
  return (
    <section className={cx('section', className)} {...rest}>
      {children}
    </section>
  );
}

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div className={cx('card', className)} {...rest}>
      {children}
    </div>
  );
}

type AccordionItem = {
  title: string;
  content: string;
};

type AccordionProps = {
  items: AccordionItem[];
};

export function Accordion({ items }: AccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="accordion">
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        const panelId = `accordion-panel-${index}`;
        const buttonId = `accordion-button-${index}`;
        return (
          <div className="accordion-item" key={item.title}>
            <button
              id={buttonId}
              className="accordion-button"
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenIndex(isOpen ? null : index)}
            >
              <span>{item.title}</span>
              <span className={cx('accordion-icon', isOpen && 'open')} aria-hidden>
                +
              </span>
            </button>
            <div
              id={panelId}
              className="accordion-panel"
              role="region"
              aria-labelledby={buttonId}
              hidden={!isOpen}
            >
              <p>{item.content}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type TabItem = {
  id: string;
  label: string;
  content: ReactNode;
};

type TabsProps = {
  tabs: TabItem[];
};

export function Tabs({ tabs }: TabsProps) {
  const [active, setActive] = useState(tabs[0]?.id);

  return (
    <div className="tabs">
      <div role="tablist" className="tab-list">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`tab-panel-${tab.id}`}
            id={`tab-${tab.id}`}
            className={cx('tab-button', active === tab.id && 'active')}
            type="button"
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`tab-panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          className={cx('tab-panel', active === tab.id && 'active')}
          hidden={active !== tab.id}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
