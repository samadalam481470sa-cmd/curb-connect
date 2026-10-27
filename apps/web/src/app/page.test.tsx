import { BRAND } from '@fieldline/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import HomePage from './page';

afterEach(cleanup);

describe('HomePage (foundation placeholder)', () => {
  it('PLT-011-FE: shows both products as equal peers', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: BRAND.name })).toBeTruthy();
    const products = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(products).toEqual([BRAND.products.roof, BRAND.products.curb]);
  });

  it('STR-005-FE: marks unfinished products as unavailable instead of faking them', () => {
    render(<HomePage />);
    expect(screen.getAllByText('Not available yet')).toHaveLength(2);
    for (const card of screen.getAllByRole('article')) {
      expect(card.getAttribute('aria-disabled')).toBe('true');
    }
  });
});
