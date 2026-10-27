import { BRAND } from '@fieldline/contracts';
import { VisuallyHidden } from '@fieldline/ui';

const products = [
  {
    key: 'roof',
    name: BRAND.products.roof,
    summary: 'Address-based roof sketching, pitch, quantities and measurement reports.',
  },
  {
    key: 'curb',
    name: BRAND.products.curb,
    summary: 'Guided job-site photos, reference calibration and preliminary estimate ranges.',
  },
] as const;

// Foundation placeholder. Both products are equal peers (PLT-011) and are shown as unavailable
// until their features are built and verified: nothing here measures or prices anything.
export default function HomePage() {
  return (
    <main className="shell">
      <header className="masthead">
        <h1>{BRAND.name}</h1>
        <p>{BRAND.description}</p>
      </header>

      <section aria-labelledby="products-heading" className="products-section">
        <h2 id="products-heading">
          <VisuallyHidden>Products</VisuallyHidden>
        </h2>
        <div className="products">
          {products.map((product) => (
            <article key={product.key} className="product-card" aria-disabled="true">
              <h3>{product.name}</h3>
              <p>{product.summary}</p>
              <span className="status-pill">Not available yet</span>
            </article>
          ))}
        </div>
      </section>

      <p className="foundation-note">
        This is the foundation build. Features appear here as they are completed and verified.
      </p>
    </main>
  );
}
