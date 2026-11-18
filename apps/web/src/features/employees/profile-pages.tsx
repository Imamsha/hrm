import { ErrorState } from '@hrm/ui-web';
import { useParams } from 'react-router';
import { Page } from '@/app/layout/page';
import { hrBase, SELF_BASE } from './api';
import { EmployeeProfile } from './employee-profile';

export function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return (
      <Page>
        <ErrorState title="Employee not found" />
      </Page>
    );
  }
  // Keyed so switching between profiles (e.g. manager links) starts fresh.
  return <EmployeeProfile key={id} profile={hrBase(id)} />;
}

export function MyProfilePage() {
  return <EmployeeProfile profile={SELF_BASE} />;
}
