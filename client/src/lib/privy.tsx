import { useEffect } from "react";
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { setAuthTokenGetter } from "./queryClient";

function AuthTokenSync({ children }: { children: React.ReactNode }) {
  const { getAccessToken, authenticated, ready } = usePrivy();

  useEffect(() => {
    if (ready) {
      setAuthTokenGetter(async () => {
        if (!authenticated) return null;
        try {
          return await getAccessToken();
        } catch {
          return null;
        }
      });
    }
  }, [ready, authenticated, getAccessToken]);

  return <>{children}</>;
}

function PrivyNotConfigured() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8 max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground">Authentication Setup Required</h2>
        <p className="text-muted-foreground">
          To enable login functionality, please configure your Privy App ID.
        </p>
        <div className="bg-muted/50 p-4 rounded-lg text-left">
          <p className="text-sm text-muted-foreground mb-2">Add to your environment:</p>
          <code className="text-xs text-primary font-mono">VITE_PRIVY_APP_ID=your-app-id</code>
        </div>
        <p className="text-xs text-muted-foreground">
          Get your App ID from <a href="https://console.privy.io" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">console.privy.io</a>
        </p>
      </div>
    </div>
  );
}

export function PrivyProviderWrapper({ children }: { children: React.ReactNode }) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  
  if (!appId || appId.startsWith('$')) {
    return <PrivyNotConfigured />;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#22c55e',
        },
        loginMethods: ['email', 'wallet', 'google', 'twitter'],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
      }}
    >
      <AuthTokenSync>
        {children}
      </AuthTokenSync>
    </PrivyProvider>
  );
}
