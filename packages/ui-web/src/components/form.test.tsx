import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField, Select } from './form.js';
import { Input } from './input.js';

describe('FormField', () => {
  it('associates label, description and error with the control', () => {
    render(
      <FormField label="Email" required error="Enter a valid email" description="Work address">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid email');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email');
  });

  it('shows the description when there is no error', () => {
    render(
      <FormField label="Name" description="As on payslips">
        <Input />
      </FormField>,
    );
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('As on payslips');
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
  });
});

describe('Select', () => {
  it('renders a non-selectable placeholder and no default selection', () => {
    render(
      <Select
        aria-label="Currency"
        value=""
        onChange={() => undefined}
        options={[
          { value: 'INR', label: 'Indian rupee' },
          { value: 'USD', label: 'US dollar' },
        ]}
      />,
    );
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Currency' });
    expect(select.value).toBe('');
    expect(screen.getByRole<HTMLOptionElement>('option', { name: 'Select…' }).disabled).toBe(true);
  });
});
