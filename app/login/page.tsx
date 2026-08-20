'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase.client';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && session) router.replace('/');
  }, [session, loading, router]);

  async function handleGoogleSignIn() {
    setSigningIn(true);
    setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) {
      setError('Could not start sign-in. Please try again.');
      setSigningIn(false);
    }
  }

  if (loading || session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Internal</p>
        <h1 className="mt-1 text-xl font-semibold text-neutral-100">AstroPal Admin</h1>
        <p className="mt-2 text-sm text-neutral-400">Sign in with your team Google account.</p>

        <button
          onClick={handleGoogleSignIn}
          disabled={signingIn}
          className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-md bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60"
        >
          {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Sign in with Google
        </button>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
