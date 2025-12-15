'use client';

import Navigation from '@/components/Navigation';

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-2">Configure your account and preferences</p>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <p className="text-gray-500">Settings interface will be implemented here...</p>
        </div>
      </main>
    </div>
  );
}
