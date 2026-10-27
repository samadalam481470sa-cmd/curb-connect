import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VisuallyHidden } from './index';

afterEach(cleanup);

describe('@fieldline/ui smoke', () => {
  it('PLT-012: keeps text in the accessibility tree while hiding it visually', () => {
    render(
      <button type="button">
        <span aria-hidden="true">ft</span>
        <VisuallyHidden>feet</VisuallyHidden>
      </button>,
    );
    const label = screen.getByText('feet');
    expect(label.style.position).toBe('absolute');
    expect(screen.getByRole('button').textContent).toContain('feet');
  });
});
