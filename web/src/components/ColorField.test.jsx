import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ColorField from './ColorField';

describe('ColorField', () => {
  it('keeps popover open after trigger click and outside mousedown on panel', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField label="لون" value="#123456" onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'لون' });
    await user.click(trigger);
    const hexInput = await screen.findByPlaceholderText('#RRGGBB');
    expect(hexInput).toBeTruthy();
    fireEvent.mouseDown(hexInput);
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('#RRGGBB')).toBeTruthy();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
