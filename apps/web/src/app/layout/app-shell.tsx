import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { Outlet } from 'react-router';
import { Header } from './header';
import { Brand, Sidebar, SidebarNav } from './sidebar';

/** Global layout: collapsible sidebar (off-canvas drawer below md), sticky header, scrolling content. */
export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-1.5 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <Sidebar />

      <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar shadow-xl md:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Description className="sr-only">Main application navigation</Dialog.Description>
            <div className="flex items-center justify-between pr-2">
              <Brand collapsed={false} />
              <Dialog.Close
                aria-label="Close navigation"
                className="flex size-7 items-center justify-center rounded-md hover:bg-sidebar-accent"
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <SidebarNav
              collapsed={false}
              onNavigate={() => {
                setMobileNavOpen(false);
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onOpenMobileNav={() => {
            setMobileNavOpen(true);
          }}
        />
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
