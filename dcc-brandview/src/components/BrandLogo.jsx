import { useState } from 'react';
import { initials } from '../lib/format.js';

const EXTS = ['png', 'svg', 'webp', 'jpg'];

/** Brand logo from /logos/<slug>.<ext>; falls back to the brand's coloured initials when no file exists. */
export default function BrandLogo({ brand, size = 24 }) {
  const [i, setI] = useState(0);
  const slug = brand && brand.slug;
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.3), flex: 'none' };
  if (!brand) {
    return <span className="bdot" style={{ ...box, borderRadius: '50%', background: 'var(--hover)', color: 'var(--text-2)', fontSize: Math.max(9, size * 0.4) }}>ALL</span>;
  }
  if (!slug || i >= EXTS.length) {
    return <span className="bdot" style={{ ...box, borderRadius: '50%', background: (brand.color || '#5e6ad2') + '22', color: brand.color || 'var(--text-2)', fontSize: Math.max(9, size * 0.4) }}>{initials(brand.name)}</span>;
  }
  return (
    <img
      key={slug + EXTS[i]}
      src={`/logos/${slug}.${EXTS[i]}`}
      alt={brand.name}
      onError={() => setI(i + 1)}
      style={{ ...box, objectFit: 'contain', background: '#fff', padding: Math.round(size * 0.1), border: '1px solid var(--line)', animation: 'popin .3s var(--ease) both' }}
    />
  );
}
