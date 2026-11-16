import { zodResolver } from '@hookform/resolvers/zod';
import type { AuthTokens } from '@hrm/shared-types';
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
} from '@hrm/ui-web';
import { createOrganizationSchema } from '@hrm/validation';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import type { z } from 'zod';
import { establishSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';

const schema = createOrganizationSchema.pick({ name: true });

export function CreateOrganizationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await api.post<AuthTokens>('/organizations', values);
      queryClient.clear();
      await establishSession(res);
      form.reset();
      onOpenChange(false);
      void navigate('/');
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['name']));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          title="New organization"
          description="You will be the owner. You can switch between organizations at any time."
        />
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <DialogBody className="flex flex-col gap-4">
            {formError ? <Alert tone="destructive">{formError}</Alert> : null}
            <FormField
              label="Organization name"
              error={form.formState.errors.name?.message}
              required
            >
              <Input autoFocus {...form.register('name')} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
