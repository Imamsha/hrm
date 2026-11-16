import '@fontsource-variable/inter';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { AppProviders } from './app/providers';
import { createRouter } from './app/router';
import { bootstrapSession } from './features/auth/session';
import { createQueryClient } from './lib/api';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

const queryClient = createQueryClient();
const router = createRouter();
// Restore the session from the httpOnly refresh cookie; guards show a spinner meanwhile.
void bootstrapSession();

createRoot(container).render(
  <StrictMode>
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
