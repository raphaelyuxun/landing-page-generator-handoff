import type { ContentData, GeneratedAsset, ProductData } from './types';

function assetUrl(code: string, name?: string, version?: string): string | undefined {
  if (!name) return undefined;
  if (name.startsWith('data:')) return name;
  const base = name.startsWith('http') ? name : `/assets/${code}/${name}`;
  if (!version) return base;
  return `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

interface Props {
  code: string;
  content: ContentData;
  products: ProductData[];
  assets: GeneratedAsset[];
  template: 'm1' | 'm2';
  version?: string;
}

const BRAND = '#2dd4a0';
const WA = '#25D366';

export default function Preview({ code, content, products, assets, template, version }: Props) {
  const bannerAsset = assets.find((a) => a.kind === 'banner');
  const bannerUrl =
    content.banner && content.banner.startsWith('http')
      ? assetUrl(code, content.banner, version)
      : assetUrl(code, bannerAsset?.exportName, version);

  return (
    <div className="relative bg-white text-sm text-gray-800">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center justify-between bg-white px-6 py-3 shadow-sm">
        <div className="text-lg font-bold tracking-tight">EaseSourcer</div>
        <button className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white" style={{ background: WA }}>
          💬 Chat on WhatsApp
        </button>
      </div>

      {/* Hero — full-width background image + dark overlay + centered white text */}
      <div
        className="relative flex flex-col items-center justify-center px-6 pb-28 pt-20 text-center text-white"
        style={{
          backgroundColor: '#1f2937',
          backgroundImage: bannerUrl
            ? `linear-gradient(rgba(15,23,42,0.5), rgba(15,23,42,0.5)), url("${bannerUrl}")`
            : 'linear-gradient(135deg,#1f2937,#374151)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <h1 className="max-w-3xl text-4xl font-extrabold leading-tight drop-shadow-lg">{content.title}</h1>
        <p className="mt-4 max-w-2xl text-base text-gray-100">{content.subtitle}</p>
        <button className="mt-7 inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-gray-900" style={{ background: BRAND }}>
          💬 Chat on WhatsApp
        </button>
      </div>

      {/* Stats (m1) — white card floating over the hero's lower edge */}
      {template === 'm1' && content.stats && (
        <div className="relative z-10 mx-auto -mt-16 max-w-5xl rounded-2xl bg-white px-8 py-7 shadow-xl">
          {content.stats.sectionTitle && <h2 className="mb-5 text-center text-xl font-bold text-gray-800">{content.stats.sectionTitle}</h2>}
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {content.stats.items.map((s, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl font-extrabold" style={{ color: BRAND }}>{s.value}</div>
                <div className="mt-1 text-xs text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trust (m2) — icon cards floating over the hero's lower edge */}
      {template === 'm2' && content.trust && (
        <div className="relative z-10 mx-auto -mt-16 max-w-5xl rounded-2xl bg-white px-8 py-7 shadow-xl">
          {content.trust.sectionTitle && <h2 className="mb-5 text-center text-xl font-bold text-gray-800">{content.trust.sectionTitle}</h2>}
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            {content.trust.items.map((t, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl">{t.icon}</div>
                <div className="mt-2 font-semibold">{t.title}</div>
                <div className="mt-1 text-xs text-gray-500">{t.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Certifications (m1) */}
      {template === 'm1' && content.certifications && (
        <div className="mx-auto max-w-5xl px-6 py-12 text-center">
          {content.certifications.sectionTitle && <h2 className="mb-6 text-xl font-bold text-gray-800">{content.certifications.sectionTitle}</h2>}
          <div className="flex flex-wrap justify-center gap-2.5">
            {content.certifications.items.map((c, i) => (
              <span key={i} className="rounded-full bg-gray-100 px-4 py-1.5 text-sm text-gray-600">{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* Products */}
      <div className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="mb-8 text-center text-xl font-bold text-gray-800">Our Best-Selling Products</h2>
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          {products.map((p, i) => {
            const img = assetUrl(code, p.images?.[0], version);
            return (
              <div key={i} className="flex flex-col overflow-hidden rounded-2xl border border-gray-200">
                <div className="aspect-square bg-gray-100">
                  {img ? <img src={img} alt={p.productName} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-gray-400">no image</div>}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="font-bold leading-snug text-gray-800">{p.productName}</div>
                  {p.subtitle && <div className="mt-0.5 text-xs text-gray-400">{p.subtitle}</div>}
                  {p.description && <div className="mt-1.5 text-sm leading-relaxed text-gray-500">{p.description}</div>}
                  <button className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold text-gray-900" style={{ background: BRAND }}>📄 Get a Quote</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Testimonials (m1) — light-gray band */}
      {template === 'm1' && content.testimonials && (
        <div className="bg-gray-50 px-6 py-14">
          <div className="mx-auto max-w-5xl">
            {content.testimonials.sectionTitle && <h2 className="mb-8 text-center text-xl font-bold text-gray-800">{content.testimonials.sectionTitle}</h2>}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              {content.testimonials.items.map((t, i) => (
                <div key={i} className="rounded-2xl bg-white p-5 shadow-sm" style={{ borderLeft: `3px solid ${BRAND}` }}>
                  <p className="text-sm italic leading-relaxed text-gray-600">“{t.quote}”</p>
                  <p className="mt-3 text-xs font-semibold" style={{ color: BRAND }}>— {t.author}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FAQ (m2) */}
      {template === 'm2' && content.faq && (
        <div className="mx-auto max-w-3xl px-6 py-14">
          {content.faq.sectionTitle && <h2 className="mb-6 text-center text-xl font-bold text-gray-800">{content.faq.sectionTitle}</h2>}
          <div className="divide-y divide-gray-200">
            {content.faq.items.map((f, i) => (
              <div key={i} className="py-4">
                <div className="font-semibold text-gray-800">{f.q}</div>
                <div className="mt-1 text-sm leading-relaxed text-gray-500">{f.a}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom CTA */}
      {content.cta && (content.cta.bottomTitle || content.cta.bottomSubtitle) && (
        <div className="px-6 py-16 text-center">
          {content.cta.bottomTitle && <h2 className="text-2xl font-bold text-gray-800">{content.cta.bottomTitle}</h2>}
          {content.cta.bottomSubtitle && <p className="mt-3 text-sm text-gray-500">{content.cta.bottomSubtitle}</p>}
          <button className="mt-6 inline-flex items-center gap-1.5 rounded-lg px-7 py-3 text-sm font-semibold text-gray-900" style={{ background: BRAND }}>📄 Get a Quote</button>
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-900 px-6 py-8 text-center text-xs text-gray-400">
        <div>© 2026 EaseSourcing. ISO 9001 · CE · OEM &amp; ODM Specialist</div>
        {content.contact && (content.contact.email || content.contact.wa) && (
          <div className="mt-1">{content.contact.email}{content.contact.email && content.contact.wa ? ' · ' : ''}{content.contact.wa && `WhatsApp ${content.contact.wa}`}</div>
        )}
      </div>

      {/* Floating WhatsApp bubble */}
      <div className="absolute bottom-5 right-5 flex h-12 w-12 items-center justify-center rounded-full text-xl text-white shadow-lg" style={{ background: WA }} title="Chat on WhatsApp">
        💬
      </div>
    </div>
  );
}
