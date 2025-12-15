'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/supabase/auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // CSS and component mount logging
  useEffect(() => {
    console.log('🎨 [LOGIN] Login Page Mounted');
    console.log('📦 [LOGIN] CSS Loaded:', document.styleSheets.length > 0);
    console.log('📊 [LOGIN] Total StyleSheets:', document.styleSheets.length);
    
    // Check if Tailwind classes are working
    const body = document.body;
    const computedStyle = window.getComputedStyle(body);
    console.log('🎯 [LOGIN] Body background:', computedStyle.backgroundColor);
    console.log('🎯 [LOGIN] Body font:', computedStyle.fontFamily);
    
    // List all stylesheets
    for (let i = 0; i < document.styleSheets.length; i++) {
      try {
        const sheet = document.styleSheets[i];
        console.log(`📄 [LOGIN] Stylesheet ${i}:`, sheet.href || 'inline');
      } catch (e) {
        console.log(`⚠️ [LOGIN] Cannot access stylesheet ${i}`);
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('🔐 [LOGIN] ============ Login Attempt Started ============');
    console.log('📧 [LOGIN] Email:', email);
    console.log('🔑 [LOGIN] Password length:', password.length);
    console.log('⏰ [LOGIN] Timestamp:', new Date().toISOString());
    
    setError('');
    setLoading(true);

    try {
      console.log('⏳ [LOGIN] Calling auth.signIn...');
      const { error: signInError } = await auth.signIn(email, password);

      if (signInError) {
        console.error('❌ [LOGIN] Sign in failed!');
        console.error('❌ [LOGIN] Error message:', signInError.message);
        console.error('❌ [LOGIN] Error details:', signInError);
        setError(signInError.message);
        setLoading(false);
        return;
      }

      console.log('✅ [LOGIN] Sign in successful!');
      console.log('🚀 [LOGIN] Redirecting to dashboard...');
      router.push('/dashboard');
    } catch (err) {
      console.error('💥 [LOGIN] Unexpected error:', err);
      setError('An unexpected error occurred. Check console for details.');
      setLoading(false);
    }
    
    console.log('🏁 [LOGIN] ============ Login Attempt Finished ============');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        {/* Debug Info Banner */}
        <div className="rounded-lg bg-blue-50 p-3 text-xs">
          <p className="font-bold text-blue-900">🔍 Debug Mode Active</p>
          <p className="text-blue-700">Check browser console (F12) for detailed logs</p>
          <p className="text-blue-700 mt-1">Stylesheets loaded: {typeof document !== 'undefined' ? document.styleSheets.length : 'loading...'}</p>
        </div>
        
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
            Accounting Reconciliation
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sign in to your account
          </p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          
          <div className="-space-y-px rounded-md shadow-sm">
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="relative block w-full rounded-t-md border-0 px-3 py-2 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-primary-600 sm:text-sm sm:leading-6"
                placeholder="Email address"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="relative block w-full rounded-b-md border-0 px-3 py-2 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-primary-600 sm:text-sm sm:leading-6"
                placeholder="Password"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <a href="/forgot-password" className="font-medium text-primary-600 hover:text-primary-500">
                Forgot your password?
              </a>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative flex w-full justify-center rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
